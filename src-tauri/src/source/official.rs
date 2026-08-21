//! 番茄小说官方 Android 正文链路（逆向自 com.pofl.fanqienoveldownloader v2026.7.26-709）。
//!
//! 内容：
//! - 官方端点 / 硬编码 AES 密钥 / 请求参数（从 APK 逆向提取，见 docs/official-api.md）
//! - 加密原语：SM3、hex、protobuf 编码、sign_ladon_like（x-ladon 签名，angr 验证）
//! - 解密：registerkey seed → AES-128-CBC-PKCS7 → 内容密钥；章节 base64 → AES-CBC → zlib/gzip → HTML
//!
//! 参考：/Users/kuangqie/Downloads/官方解密/reconstructed/

use base64::Engine;
use cbc::cipher::{BlockDecryptMut, KeyIvInit};
use md5::{Digest as Md5Digest, Md5};

// ---------------------------------------------------------------------------
// 常量（从 APK 逆向提取）
// ---------------------------------------------------------------------------

/// 官方 API 硬编码 AES-128 密钥（.rodata@0x16afb0 实测）。
const OFFICIAL_AES_KEY: [u8; 16] = [
    0xac, 0x25, 0xc6, 0x7d, 0xdd, 0x8f, 0x38, 0xc1, 0xb3, 0x7a, 0x23, 0x48, 0x82, 0x8e, 0x22, 0x2e,
];

/// 官方 API base URL（故障切换，APK 内 FANQIE_OFFICIAL_BASE_URL 候选）。
pub const OFFICIAL_BASE_URLS: [&str; 4] = [
    "https://api5-normal-sinfonlinec.fqnovel.com",
    "https://api5-normal-lf.fqnovel.com",
    "https://api5-normal-hl.fqnovel.com",
    "https://api5-normal.fqnovel.com",
];

/// 设备注册接口。
pub const DEVICE_REGISTER_URLS: [&str; 4] = [
    "https://log.snssdk.com/service/2/device_register/",
    "https://log.isnssdk.com/service/2/device_register/",
    "https://log.tiktokv.com/service/2/device_register/",
    "https://log.byteoversea.com/service/2/device_register/",
];

/// 官方接口路径。
pub const PATH_DIRECTORY: &str = "/reading/bookapi/directory/all_items/v1";
pub const PATH_SEARCH: &str = "/reading/bookapi/search/tab/v1";
pub const PATH_READER_FULL: &str = "/reading/reader/full/v1";
pub const PATH_REGISTERKEY: &str = "/reading/crypt/registerkey";

/// 官方 UA（APK 内 official_user_agent）。
pub const OFFICIAL_UA: &str = "com.dragon.read/6.0.0 (Linux; U; Android 12; zh_CN; Build/SQ3A.220705.004)";

/// 固定常量串（签名 / 密钥派生用，从 APK 提取）。
const SALT_HOST: &str = "-1611921764-3019";
const NONCE_PREFIX: &str = "nonce-";
const LADON_APPEND: &[u8; 4] = b"1967";

// ---------------------------------------------------------------------------
// 加密原语
// ---------------------------------------------------------------------------

/// SM3 国密哈希（标准实现）。
pub fn sm3_hash(data: &[u8]) -> [u8; 32] {
    use sm3::Digest as Sm3Digest;
    let mut hasher = sm3::Sm3::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// 小写 hex 编码。
pub fn hex_lower(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

/// protobuf 字段。
#[derive(Debug, Clone)]
pub struct ProtoField {
    /// 字段号
    pub field_num: u64,
    /// wire type：0 = varint，2 = length-delimited
    pub wire_type: u8,
    /// wire type 0 时的整数值
    pub varint_val: u64,
    /// wire type 2 时的字节载荷
    pub bytes: Vec<u8>,
}

fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            break;
        }
        out.push(byte | 0x80);
    }
}

/// protobuf 字段编码（标准编码，逆向自 encode_proto@0x493ba8）。
pub fn encode_proto(fields: &[ProtoField]) -> Vec<u8> {
    let mut out = Vec::new();
    for f in fields {
        write_varint(&mut out, (f.field_num << 3) | f.wire_type as u64);
        match f.wire_type {
            0 => write_varint(&mut out, f.varint_val),
            2 => {
                write_varint(&mut out, f.bytes.len() as u64);
                out.extend_from_slice(&f.bytes);
            }
            _ => {}
        }
    }
    out
}

// ---------------------------------------------------------------------------
// sign_ladon_like（x-ladon 签名，angr 反编译验证）
// ---------------------------------------------------------------------------

const MASK64: u64 = u64::MAX;

#[inline]
fn ror64(x: u64, n: u32) -> u64 {
    x.rotate_right(n)
}

#[inline]
fn rol64(x: u64, n: u32) -> u64 {
    x.rotate_left(n)
}

/// 用 4 字节随机 nonce 计算 x-ladon 的 16 字节状态。
/// 逆向自 sign_ladon_like@0x493e04：
/// MD5(nonce ‖ "1967") → hex → 34 轮密钥流展开 → 34 词海绵混合 → 16 字节状态。
/// 调用方再把 16 字节状态 base64 后作为 x-ladon 头。
///
/// 注意：若 sign_query 反编译表明该函数还接收「待签名数据」参与 MD5，
/// 需要同步调整（见 docs/official-api.md）。
pub fn sign_ladon_state(nonce: [u8; 4]) -> [u8; 16] {
    // 1) MD5(nonce ‖ "1967")
    let mut hasher = Md5::new();
    hasher.update(&nonce);
    hasher.update(LADON_APPEND);
    let digest = hasher.finalize();
    let hex_s = hex_lower(&digest); // 32 字符

    // 2) 288 字节工作区，[0:32] = hex
    let mut buf = [0u8; 288];
    buf[..32].copy_from_slice(hex_s.as_bytes());

    // 3) 34 轮密钥流展开（写 buf[8 .. 8+34*8]）
    //    状态机：v85 / v88 两个 64 位状态，st 为 32 字节滚动窗口
    let mut v85 = u64::from_le_bytes(hex_s[0..8].as_bytes().try_into().unwrap());
    let mut st = [0u8; 32];
    st[..24].copy_from_slice(&hex_s.as_bytes()[8..32]);
    let mut v88 = u64::from_le_bytes(st[0..8].try_into().unwrap());
    for i in 0..34u64 {
        let v90 = (ror64(v88, 8).wrapping_add(v85) ^ i) & MASK64;
        st[16..24].copy_from_slice(&v90.to_le_bytes());
        v85 = (v90 ^ rol64(v85, 3)) & MASK64;
        let v92 = st[8..24].to_vec(); // 128 位窗口
        v88 = u64::from_le_bytes(st[0..8].try_into().unwrap());
        let off = 8 + (i as usize) * 8;
        buf[off..off + 8].copy_from_slice(&v85.to_le_bytes());
        st[..16].copy_from_slice(&v92);
    }

    // 4) 34 词海绵混合（词序 = buf[0..264]，每 8 字节一词）
    let mut words = [0u64; 34];
    for (j, w) in words.iter_mut().enumerate() {
        *w = u64::from_le_bytes(buf[j * 8..j * 8 + 8].try_into().unwrap());
    }
    let mut acc = (words[0] ^ (ror64(words[1], 8).wrapping_add(words[0])) & MASK64) & MASK64;
    let mut rolv = (acc ^ rol64(words[0], 3)) & MASK64;
    for w in &words[1..] {
        acc = (w ^ (ror64(acc, 8).wrapping_add(rolv) & MASK64)) & MASK64;
        rolv = (acc ^ rol64(rolv, 3)) & MASK64;
    }

    // 5) 输出 16 字节状态 = (acc, acc ^ ROL(rolv, 3))
    let mut out = [0u8; 16];
    out[..8].copy_from_slice(&acc.to_le_bytes());
    out[8..].copy_from_slice(&(acc ^ rol64(rolv, 3)).to_le_bytes());
    out
}

/// x-ladon 头的最终字符串 = base64(16 字节状态)。
pub fn sign_ladon(nonce: [u8; 4]) -> String {
    let state = sign_ladon_state(nonce);
    base64::engine::general_purpose::STANDARD.encode(state)
}

// ---------------------------------------------------------------------------
// 解密（registerkey seed + 章节正文）
// ---------------------------------------------------------------------------

type Aes128Cbc = cbc::Decryptor<aes::Aes128>;

/// 随机 16 字节（IV / 部分请求用）。
pub fn random_iv() -> [u8; 16] {
    let mut iv = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut iv);
    iv
}

/// 解密 registerkey 返回的 seed：base64 → AES-128-CBC-PKCS7（硬编码密钥，IV=解码后前 16 字节）。
/// 返回内容密钥。
pub fn decrypt_register_seed(seed: &str) -> Result<Vec<u8>, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(seed)
        .map_err(|e| format!("registerkey seed base64 解码失败: {e}"))?;
    if decoded.len() < 0x11 || decoded.len() & 0xf != 0 {
        return Err("registerkey seed 密文长度无效".into());
    }
    let iv = &decoded[..16];
    let cipher = &decoded[16..];
    let buf = cipher.to_vec();
    let dec = Aes128Cbc::new_from_slices(&OFFICIAL_AES_KEY, iv)
        .map_err(|e| format!("AES 初始化失败: {e}"))?;
    let plain = dec
        .decrypt_padded_vec_mut::<block_padding::Pkcs7>(&buf)
        .map_err(|e| format!("registerkey seed PKCS#7 解密失败: {e}"))?;
    Ok(plain)
}

/// 解密章节正文：base64 → AES-128-CBC-PKCS7（内容密钥，IV=解码后前 16 字节）→ zlib/gzip 解压 → HTML。
pub fn decrypt_chapter_content(encoded: &str, content_key: &[u8]) -> Result<String, String> {
    if content_key.len() != 16 {
        return Err("官方正文 AES key 长度无效".into());
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("正文 base64 解码失败: {e}"))?;
    if decoded.len() < 0x11 || decoded.len() & 0xf != 0 {
        return Err("官方正文密文长度无效".into());
    }
    let iv = &decoded[..16];
    let cipher = &decoded[16..];
    let buf = cipher.to_vec();
    let dec = Aes128Cbc::new_from_slices(content_key, iv)
        .map_err(|e| format!("AES 初始化失败: {e}"))?;
    let plain = dec
        .decrypt_padded_vec_mut::<block_padding::Pkcs7>(&buf)
        .map_err(|e| format!("官方正文 PKCS#7 解密失败: {e}"))?;

    // zlib / gzip 解压
    let decompressed = decompress_auto(&plain)?;
    Ok(String::from_utf8_lossy(&decompressed).into_owned())
}

/// 尝试 zlib，再 gzip。
fn decompress_auto(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Read;
    // 先试 zlib（官方正文 zlib）
    if let Ok(mut d) = flate2::read::ZlibDecoder::new(data).read_to_end_vec() {
        return Ok(d);
    }
    // 再试 gzip（官方正文 gzip）
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(data)
        .read_to_end(&mut out)
        .map_err(|e| format!("正文解压失败: {e}"))?;
    Ok(out)
}

/// 小工具：Read::read_to_end 返回 Vec。
trait ReadToEndVec {
    fn read_to_end_vec(&mut self) -> std::io::Result<Vec<u8>>;
}
impl<R: std::io::Read> ReadToEndVec for R {
    fn read_to_end_vec(&mut self) -> std::io::Result<Vec<u8>> {
        let mut buf = Vec::new();
        self.read_to_end(&mut buf)?;
        Ok(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_ladon_state_matches_python_reference() {
        // 固定 nonce，与 Python 参考实现（sign_ladon_like.py）比对。
        // Python 参考：sign_ladon_like(bytes([1,2,3,4])) -> f078cfff8c4d36d9a9c1fd3af0c3ef2f
        let nonce = [0x01, 0x02, 0x03, 0x04];
        let state = sign_ladon_state(nonce);
        assert_eq!(
            hex::encode(state),
            "f078cfff8c4d36d9a9c1fd3af0c3ef2f",
            "sign_ladon_state 与 Python 参考实现不一致"
        );
        // 确定性：同 nonce 输出一致
        assert_eq!(sign_ladon_state(nonce), sign_ladon_state(nonce));
        // nonce 敏感性
        assert_ne!(sign_ladon_state(nonce), sign_ladon_state([0x05, 0x06, 0x07, 0x08]));
    }

    #[test]
    fn decrypt_register_seed_roundtrip() {
        // 用同一个硬编码密钥加密，再解密，验证链路正确。
        use cbc::cipher::{BlockEncryptMut, KeyIvInit};
        type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

        let iv = [0x11u8; 16];
        let plain = b"0123456789abcdef0123456789abcdef".to_vec(); // 32B，2 块
        let enc = Aes128CbcEnc::new_from_slices(&OFFICIAL_AES_KEY, &iv).unwrap();
        let ct = enc.encrypt_padded_vec_mut::<block_padding::Pkcs7>(&plain);
        let mut seed = iv.to_vec();
        seed.extend_from_slice(&ct);
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode(&seed);

        let key = decrypt_register_seed(&seed_b64).unwrap();
        assert_eq!(key, plain);
    }
}

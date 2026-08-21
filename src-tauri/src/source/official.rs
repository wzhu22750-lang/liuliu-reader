//! 番茄小说官方 Android 正文链路（逆向自 com.pofl.fanqienoveldownloader v2026.7.26-709）。
//!
//! 内容：
//! - 设备注册 `/service/2/device_register/` → device_id / iid
//! - 请求签名：`x-ladon`（Speck 加密 khronos-license-aid）+ `x-argus` + `x-gorgon` + `x-khronos`
//! - `POST /reading/crypt/registerkey` → AES-128-CBC 解密 seed → 内容密钥
//! - `GET /reading/reader/full/v1`（及 batch_full）→ AES-CBC + zlib/gzip → HTML 正文
//!
//! 参考：`/Users/kuangqie/Downloads/官方解密/reconstructed/`

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use aes::cipher::{BlockEncrypt, KeyInit};
use base64::Engine;
use cbc::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use md5::{Digest as Md5Digest, Md5};
use rand::Rng;
use serde_json::{json, Value};

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
pub const PATH_DIRECTORY: &str = "/reading/bookapi/directory/all_items/v1/";
pub const PATH_SEARCH: &str = "/reading/bookapi/search/tab/v";
pub const PATH_READER_FULL: &str = "/reading/reader/full/v1/";
pub const PATH_BATCH_FULL: &str = "/reading/reader/batch_full/v1/";
pub const PATH_REGISTERKEY: &str = "/reading/crypt/registerkey";

/// 官方 UA（APK 内 official_user_agent，version 与 query 对齐）。
pub const OFFICIAL_UA: &str =
    "com.dragon.read/71332 (Linux; U; Android 12; zh_CN; Pixel 6; Build/SQ3A.220705.004)";

/// 固定常量串（签名 / 密钥派生用，从 APK 提取）。
const LICENSE_ID: u64 = 1_611_921_764;
const AID: u32 = 1967;
const VERSION_CODE: &str = "71332";
const VERSION_NAME: &str = "7.1.3.32";
const LADON_APPEND: &[u8; 4] = b"1967";
const ARGUS_SIGN_KEY: [u8; 32] = [
    0xac, 0x1a, 0xda, 0xae, 0x95, 0xa7, 0xaf, 0x94, 0xa5, 0x11, 0x4a, 0xb3, 0xb3, 0xa9, 0x7d,
    0xd8, 0x00, 0x50, 0xaa, 0x0a, 0x39, 0x31, 0x4c, 0x40, 0x52, 0x8c, 0xae, 0xc9, 0x52, 0x56,
    0xc2, 0x8c,
];

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

fn md5_bytes(data: &[u8]) -> [u8; 16] {
    let mut hasher = Md5::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn sha256_bytes(data: &[u8]) -> [u8; 32] {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn pkcs7_pad(data: &[u8], block: usize) -> Vec<u8> {
    let pad = block - (data.len() % block);
    let mut out = data.to_vec();
    out.extend(std::iter::repeat(pad as u8).take(pad));
    out
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn random_nonce() -> [u8; 4] {
    let mut nonce = [0u8; 4];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce);
    nonce
}

fn json_first_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(v) = value.get(*key) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
            if let Some(n) = v.as_u64() {
                return Some(n.to_string());
            }
            if let Some(n) = v.as_i64() {
                return Some(n.to_string());
            }
        }
    }
    None
}

fn json_walk_item_id<'a>(value: &'a Value) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            if map.contains_key("item_id") || map.contains_key("itemId") || map.contains_key("content") {
                return Some(value);
            }
            for v in map.values() {
                if let Some(hit) = json_walk_item_id(v) {
                    return Some(hit);
                }
            }
            None
        }
        Value::Array(arr) => arr.iter().find_map(json_walk_item_id),
        _ => None,
    }
}

fn normalize_content_key(plain: Vec<u8>) -> Result<Vec<u8>, String> {
    if plain.len() == 16 {
        return Ok(plain);
    }
    if plain.len() == 32 && plain.iter().all(|b| b.is_ascii_hexdigit()) {
        return hex::decode(&plain).map_err(|e| format!("内容密钥 hex 解码失败: {e}"));
    }
    if plain.len() > 16 {
        return Ok(plain[..16].to_vec());
    }
    Err(format!("内容密钥长度无效: {} 字节", plain.len()))
}

// ---------------------------------------------------------------------------
// 完整 x-ladon：base64(nonce ‖ Speck(md5(nonce‖aid), "{khronos}-{license}-{aid}"))
// 密钥流展开与 sign_ladon_like 同源（POf-L .so @ 0x493e04 / linzj ladon.rs）。
// ---------------------------------------------------------------------------

fn ladon_round_keys(md5hex: &[u8]) -> [u8; 288] {
    let mut table = [0u8; 288];
    table[..32].copy_from_slice(&md5hex[..32]);
    let mut queue: Vec<u64> = (0..4)
        .map(|i| u64::from_le_bytes(table[i * 8..i * 8 + 8].try_into().unwrap()))
        .collect();
    let mut b0 = queue.remove(0);
    let mut b8 = queue.remove(0);
    for i in 0..0x22u64 {
        let x9 = b0;
        let mut x8 = ror64(b8, 8).wrapping_add(x9) ^ i;
        queue.push(x8);
        x8 ^= ror64(x9, 61);
        let off = (i as usize + 1) * 8;
        table[off..off + 8].copy_from_slice(&x8.to_le_bytes());
        b0 = x8;
        b8 = queue.remove(0);
    }
    table
}

fn ladon_encrypt_block(round_keys: &[u8], input: &[u8]) -> [u8; 16] {
    let mut d0 = u64::from_le_bytes(input[..8].try_into().unwrap());
    let mut d1 = u64::from_le_bytes(input[8..16].try_into().unwrap());
    for i in 0..0x22u64 {
        let hash = u64::from_le_bytes(round_keys[i as usize * 8..][..8].try_into().unwrap());
        d1 = hash ^ d0.wrapping_add(ror64(d1, 8));
        d0 = d1 ^ ror64(d0, 0x3D);
    }
    let mut out = [0u8; 16];
    out[..8].copy_from_slice(&d0.to_le_bytes());
    out[8..].copy_from_slice(&d1.to_le_bytes());
    out
}

/// 线上请求使用的 x-ladon 头。
pub fn sign_ladon_header(khronos: u64, nonce: [u8; 4]) -> String {
    let data = format!("{khronos}-{LICENSE_ID}-{AID}");
    let mut keygen = nonce.to_vec();
    keygen.extend_from_slice(AID.to_string().as_bytes());
    let md5hex = hex_lower(&md5_bytes(&keygen));
    let keys = ladon_round_keys(md5hex.as_bytes());
    let padded = pkcs7_pad(data.as_bytes(), 16);
    let mut encrypted = Vec::with_capacity(padded.len());
    for chunk in padded.chunks(16) {
        encrypted.extend_from_slice(&ladon_encrypt_block(&keys, chunk));
    }
    let mut out = Vec::with_capacity(4 + encrypted.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&encrypted);
    base64::engine::general_purpose::STANDARD.encode(out)
}

// ---------------------------------------------------------------------------
// x-argus：protobuf → AES-128-ECB → XOR → AES-128-CBC → base64
// ---------------------------------------------------------------------------

enum ArgusVal {
    Varint(u64),
    Bytes(Vec<u8>),
    Nested(Vec<(u64, ArgusVal)>),
}

fn encode_argus(fields: &[(u64, ArgusVal)]) -> Vec<u8> {
    let mut proto = Vec::new();
    for (num, val) in fields {
        match val {
            ArgusVal::Varint(v) => proto.push(ProtoField {
                field_num: *num,
                wire_type: 0,
                varint_val: *v,
                bytes: Vec::new(),
            }),
            ArgusVal::Bytes(b) => proto.push(ProtoField {
                field_num: *num,
                wire_type: 2,
                varint_val: 0,
                bytes: b.clone(),
            }),
            ArgusVal::Nested(inner) => proto.push(ProtoField {
                field_num: *num,
                wire_type: 2,
                varint_val: 0,
                bytes: encode_argus(inner),
            }),
        }
    }
    encode_proto(&proto)
}

fn argus_hash6(data: Option<&[u8]>) -> Vec<u8> {
    let digest = match data {
        Some(d) if !d.is_empty() => sha256_bytes(d),
        _ => sha256_bytes(&[0u8; 16]),
    };
    digest[..6].to_vec()
}

fn xor_reverse_prefix(data: &[u8], xor_len: usize) -> Vec<u8> {
    let mut d = data.to_vec();
    let xor_array: Vec<u8> = d[..8.min(d.len())].to_vec();
    for i in 8..xor_len.min(d.len()) {
        d[i] ^= xor_array[i % 8];
    }
    d.reverse();
    d
}

pub fn sign_argus(query: &str, body: Option<&str>, timestamp: u64, device_id: &str) -> String {
    let rand_val = rand::thread_rng().gen_range(0..0x7FFF_FFFFu32) as u64;
    let body_hash = match body {
        Some(s) if !s.is_empty() => argus_hash6(hex::decode(s).ok().as_deref().or(Some(s.as_bytes()))),
        _ => argus_hash6(None),
    };
    let fields = vec![
        (1, ArgusVal::Varint(0x2020_0929u64 << 1)),
        (2, ArgusVal::Varint(2)),
        (3, ArgusVal::Varint(rand_val)),
        (4, ArgusVal::Bytes(AID.to_string().into_bytes())),
        (5, ArgusVal::Bytes(device_id.as_bytes().to_vec())),
        (6, ArgusVal::Bytes(LICENSE_ID.to_string().into_bytes())),
        (7, ArgusVal::Bytes(VERSION_NAME.as_bytes().to_vec())),
        (8, ArgusVal::Bytes(b"v04.04.05-ov-android".to_vec())),
        (9, ArgusVal::Varint(134_744_640)),
        (10, ArgusVal::Bytes(vec![0u8; 8])),
        (11, ArgusVal::Varint(0)),
        (12, ArgusVal::Varint(timestamp << 1)),
        (13, ArgusVal::Bytes(body_hash)),
        (14, ArgusVal::Bytes(argus_hash6(Some(query.as_bytes())))),
        (
            15,
            ArgusVal::Nested(vec![
                (1, ArgusVal::Varint(1)),
                (2, ArgusVal::Varint(1)),
                (3, ArgusVal::Varint(1)),
                (7, ArgusVal::Varint(3_348_294_860)),
            ]),
        ),
        (16, ArgusVal::Bytes(Vec::new())),
        (20, ArgusVal::Bytes(b"none".to_vec())),
        (21, ArgusVal::Varint(738)),
        (25, ArgusVal::Varint(2)),
    ];
    let pb = pkcs7_pad(&encode_argus(&fields), 16);
    let derived = {
        let mut salt = ARGUS_SIGN_KEY.to_vec();
        salt.extend_from_slice(&[0xf2, 0x81, 0x61, 0x6f]);
        salt.extend_from_slice(&ARGUS_SIGN_KEY);
        sha256_bytes(&salt)
    };
    let aes_inner = aes::Aes128::new_from_slice(&derived[..16]).expect("aes key");
    let mut enc_pb = vec![0u8; pb.len()];
    for i in 0..(pb.len() / 16) {
        let mut block = aes::Block::clone_from_slice(&pb[i * 16..(i + 1) * 16]);
        aes_inner.encrypt_block(&mut block);
        enc_pb[i * 16..(i + 1) * 16].copy_from_slice(&block);
    }
    let mut prefixed = Vec::with_capacity(8 + enc_pb.len());
    prefixed.extend_from_slice(&[0xf2, 0xf7, 0xfc, 0xff, 0xf2, 0xf7, 0xfc, 0xff]);
    prefixed.extend_from_slice(&enc_pb);
    let inner = xor_reverse_prefix(&prefixed, enc_pb.len() + 8);
    let mut buffer = Vec::new();
    buffer.extend_from_slice(&[0xa6, 0x6e, 0xad, 0x9f, 0x77, 0x01, 0xd0, 0x0c, 0x18]);
    buffer.extend_from_slice(&inner);
    buffer.extend_from_slice(b"ao");
    let aes_key = md5_bytes(&ARGUS_SIGN_KEY[..16]);
    let aes_iv = md5_bytes(&ARGUS_SIGN_KEY[16..]);
    let cipher = cbc::Encryptor::<aes::Aes128>::new_from_slices(&aes_key, &aes_iv).expect("cbc");
    let encrypted = cipher.encrypt_padded_vec_mut::<block_padding::Pkcs7>(&pkcs7_pad(&buffer, 16));
    let mut result = Vec::with_capacity(2 + encrypted.len());
    result.extend_from_slice(&[0xf2, 0x81]);
    result.extend_from_slice(&encrypted);
    base64::engine::general_purpose::STANDARD.encode(result)
}

// ---------------------------------------------------------------------------
// x-gorgon 0404
// ---------------------------------------------------------------------------

fn gorgon_nibble_swap(num: u8) -> u8 {
    let s = format!("{num:02x}");
    u8::from_str_radix(&format!("{}{}", s.as_bytes()[1] as char, s.as_bytes()[0] as char), 16).unwrap_or(0)
}

pub fn sign_gorgon(params: &str, body: &str, cookie: &str, timestamp: u64) -> String {
    let mut debug = Vec::with_capacity(20);
    let url_md5 = hex_lower(&md5_bytes(params.as_bytes()));
    for i in 0..4 {
        debug.push(u8::from_str_radix(&url_md5[2 * i..2 * i + 2], 16).unwrap_or(0));
    }
    if body.is_empty() {
        debug.extend_from_slice(&[0, 0, 0, 0]);
    } else {
        let h = hex_lower(&md5_bytes(body.as_bytes()));
        for i in 0..4 {
            debug.push(u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap_or(0));
        }
    }
    if cookie.is_empty() {
        debug.extend_from_slice(&[0, 0, 0, 0]);
    } else {
        let h = hex_lower(&md5_bytes(cookie.as_bytes()));
        for i in 0..4 {
            debug.push(u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap_or(0));
        }
    }
    debug.extend_from_slice(&[0, 0, 0, 0]);
    let khronos = format!("{timestamp:x}");
    for i in 0..4 {
        if 2 * i + 2 <= khronos.len() {
            debug.push(u8::from_str_radix(&khronos[2 * i..2 * i + 2], 16).unwrap_or(0));
        } else {
            debug.push(0);
        }
    }
    let hex_510: [u8; 8] = [0x1E, 0x00, 0xE0, 228, 0x93, 0x45, 0x01, 208];
    let mut hex_920: Vec<u16> = (0..0x100).map(|i| i as u16).collect();
    let mut tmp: Option<u16> = None;
    for i in 0..0x100u16 {
        let a = if i == 0 {
            0
        } else if let Some(t) = tmp {
            t
        } else {
            hex_920[i as usize - 1]
        };
        let b = hex_510[(i % 8) as usize] as u16;
        let mut a_val = a;
        if a_val == 0x55 && i != 1 && tmp != Some(0x55) {
            a_val = 0;
        }
        let mut c = a_val + i + b;
        while c >= 0x100 {
            c -= 0x100;
        }
        tmp = if c < i { Some(c) } else { None };
        hex_920[i as usize] = hex_920[c as usize];
    }
    let mut tmp_hex = hex_920.clone();
    let mut tmp_add: Vec<u16> = Vec::new();
    let length = 0x14usize;
    for i in 0..length {
        let a = debug[i];
        let b = tmp_add.last().copied().unwrap_or(0);
        let mut c = hex_920[i + 1] + b;
        while c >= 0x100 {
            c -= 0x100;
        }
        tmp_add.push(c);
        let d = tmp_hex[c as usize];
        tmp_hex[i + 1] = d;
        let mut e = d + d;
        while e >= 0x100 {
            e -= 0x100;
        }
        debug[i] = a ^ (tmp_hex[e as usize] as u8);
    }
    for i in 0..length {
        let b = gorgon_nibble_swap(debug[i]);
        let d = b ^ debug[(i + 1) % length];
        debug[i] = !(d.reverse_bits() ^ length as u8);
    }
    let mut hex_result = String::new();
    for item in &debug {
        hex_result.push_str(&format!("{item:02x}"));
    }
    format!("0404{:02x}{:02x}0001{hex_result}", hex_510[7], hex_510[3])
}

/// registerkey 请求体：随机 IV ‖ AES-CBC(device_id_le ‖ user_id_le)。逆向自 register_key_body@0x486618。
pub fn build_register_content(device_id: &str) -> Result<String, String> {
    let did: i64 = device_id.parse().map_err(|_| "官方 registerkey device_id 无效".to_string())?;
    let mut payload = Vec::with_capacity(16);
    payload.extend_from_slice(&did.to_le_bytes());
    payload.extend_from_slice(&0i64.to_le_bytes());
    let iv = random_iv();
    type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;
    let enc = Aes128CbcEnc::new_from_slices(&OFFICIAL_AES_KEY, &iv)
        .map_err(|e| format!("registerkey AES 初始化失败: {e}"))?;
    let ct = enc.encrypt_padded_vec_mut::<block_padding::Pkcs7>(&payload);
    let mut combined = iv.to_vec();
    combined.extend_from_slice(&ct);
    Ok(base64::engine::general_purpose::STANDARD.encode(combined))
}

// ---------------------------------------------------------------------------
// 官方 HTTP 客户端
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct DeviceCache {
    device_id: String,
    iid: String,
    openudid: String,
    cdid: String,
    #[serde(default)]
    content_key_hex: String,
}

#[derive(Debug, Clone)]
pub struct OfficialSearchHit {
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub cover_url: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OfficialBook {
    pub book_id: String,
    pub title: String,
    pub author: String,
    pub cover_url: Option<String>,
    pub description: Option<String>,
    pub chapters: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct OfficialChapter {
    pub title: String,
    pub content: String,
}

pub struct OfficialApi {
    http: reqwest::Client,
    device_id: String,
    iid: String,
    openudid: String,
    cdid: String,
    content_key: Option<Vec<u8>>,
}

impl OfficialApi {
    pub fn new(http: reqwest::Client) -> Self {
        let cache = load_device_cache();
        Self {
            http,
            device_id: cache.as_ref().map(|c| c.device_id.clone()).unwrap_or_default(),
            iid: cache.as_ref().map(|c| c.iid.clone()).unwrap_or_default(),
            openudid: cache
                .as_ref()
                .map(|c| c.openudid.clone())
                .unwrap_or_else(|| format!("{:016x}", rand::thread_rng().gen::<u64>())),
            cdid: cache
                .as_ref()
                .map(|c| c.cdid.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            content_key: cache.and_then(|c| {
                if c.content_key_hex.len() == 32 {
                    hex::decode(c.content_key_hex).ok()
                } else {
                    None
                }
            }),
        }
    }

    fn persist(&self) {
        let cache = DeviceCache {
            device_id: self.device_id.clone(),
            iid: self.iid.clone(),
            openudid: self.openudid.clone(),
            cdid: self.cdid.clone(),
            content_key_hex: self
                .content_key
                .as_ref()
                .map(|k| hex::encode(k))
                .unwrap_or_default(),
        };
        let path = device_cache_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&cache) {
            let _ = std::fs::write(path, text);
        }
    }

    pub async fn ensure(&mut self) -> Result<(), String> {
        if self.device_id.is_empty() || self.device_id == "0" {
            self.register_device().await?;
        }
        if self.content_key.is_none() {
            self.register_key().await?;
        }
        Ok(())
    }

    async fn register_device(&mut self) -> Result<(), String> {
        let body = json!({
            "magic_tag": "ss_app_log",
            "header": {
                "display_name": "novelapp",
                "update_version_code": 71332,
                "manifest_version_code": 71332,
                "aid": AID,
                "channel": "googleplay",
                "package": "com.dragon.read",
                "app_name": "novelapp",
                "version_code": 71332,
                "version_name": VERSION_NAME,
                "device_model": "Pixel 6",
                "device_brand": "google",
                "device_manufacturer": "Google",
                "os_version": "12",
                "os_api": 31,
                "device_platform": "android",
                "language": "zh",
                "region": "CN",
                "resolution": "1080x2400",
                "dpi": 420,
                "rom_version": "SQ3A.220705.004",
                "cdid": self.cdid,
                "openudid": self.openudid,
            },
            "_gen_time": unix_seconds(),
        });
        let mut last_err = "设备注册失败".to_string();
        for url in DEVICE_REGISTER_URLS {
            match self
                .http
                .post(url)
                .header("Content-Type", "application/json")
                .header("User-Agent", OFFICIAL_UA)
                .json(&body)
                .send()
                .await
            {
                Ok(resp) => {
                    let text = resp.text().await.unwrap_or_default();
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        let did = json_first_string(&v, &["device_id_str", "device_id"]).unwrap_or_default();
                        let iid = json_first_string(&v, &["install_id_str", "install_id"]).unwrap_or_default();
                        if !did.is_empty() && did != "0" {
                            self.device_id = did;
                            self.iid = iid;
                            self.persist();
                            return Ok(());
                        }
                        last_err = format!("device_register 响应缺少 install_id/device_id: {text}");
                    } else {
                        last_err = format!("device_register 非 JSON: {text}");
                    }
                }
                Err(e) => last_err = format!("请求番茄官方 device_register 失败: {e}"),
            }
        }
        Err(last_err)
    }

    async fn register_key(&mut self) -> Result<(), String> {
        if self.device_id.is_empty() {
            return Err("官方 registerkey device_id 无效".into());
        }
        let content = build_register_content(&self.device_id)?;
        let body = json!({ "content": content, "keyver": 1 }).to_string();
        let (status, text) = self
            .signed_request("POST", PATH_REGISTERKEY, &[], Some(body))
            .await?;
        if text.is_empty() {
            return Err(format!("官方 registerkey 返回空响应 (HTTP {status})"));
        }
        let v: Value = serde_json::from_str(&text)
            .map_err(|e| format!("官方 registerkey 响应不是 JSON: {e}; {text}"))?;
        let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            return Err(format!(
                "请求番茄官方 registerkey 失败: code={code} msg={}",
                v.get("message").and_then(|m| m.as_str()).unwrap_or("?")
            ));
        }
        let data = v.get("data").cloned().unwrap_or(Value::Null);
        let seed = json_first_string(&data, &["seed", "key"])
            .ok_or_else(|| "官方 registerkey 响应缺少 seed".to_string())?;
        let key = normalize_content_key(decrypt_register_seed(&seed)?)?;
        self.content_key = Some(key);
        self.persist();
        Ok(())
    }

    fn common_query(&self, extra: &[(&str, &str)]) -> String {
        let ts = unix_millis().to_string();
        let mut pairs: Vec<(&str, String)> = vec![
            ("ac", "wifi".into()),
            ("aid", AID.to_string()),
            ("app_name", "novelapp".into()),
            ("version_code", VERSION_CODE.into()),
            ("version_name", VERSION_NAME.into()),
            ("device_platform", "android".into()),
            ("os", "android".into()),
            ("ssmix", "a".into()),
            ("device_type", "Pixel 6".into()),
            ("device_brand", "google".into()),
            ("os_api", "31".into()),
            ("os_version", "12".into()),
            ("device_id", self.device_id.clone()),
            ("iid", self.iid.clone()),
            ("_rticket", ts),
            ("cdid", self.cdid.clone()),
            ("openudid", self.openudid.clone()),
        ];
        for (k, v) in extra {
            pairs.push((*k, (*v).to_string()));
        }
        pairs
            .iter()
            .map(|(k, v)| format!("{}={}", k, urlencoding_lite(v)))
            .collect::<Vec<_>>()
            .join("&")
    }

    async fn signed_request(
        &self,
        method: &str,
        path: &str,
        extra: &[(&str, &str)],
        body: Option<String>,
    ) -> Result<(u16, String), String> {
        let qs = self.common_query(extra);
        let khronos = unix_seconds();
        let ts_ms = unix_millis();
        let nonce = random_nonce();
        let ladon = sign_ladon_header(khronos, nonce);
        let argus = sign_argus(&qs, body.as_deref(), khronos, &self.device_id);
        let cookie = format!(
            "store-region=cn-zj; store-region-src=did; install_id={}",
            self.iid
        );
        let gorgon = sign_gorgon(&qs, body.as_deref().unwrap_or(""), &cookie, khronos);
        let ticket = ts_ms.to_string();
        let reading = format!("{ts_ms}-{:08x}", rand::thread_rng().gen::<u32>());
        let mut last_err = "请求番茄官方 API 失败".to_string();
        for base in OFFICIAL_BASE_URLS {
            let url = format!("{base}{path}?{qs}");
            let mut req = match method {
                "POST" => self.http.post(&url),
                _ => self.http.get(&url),
            };
            req = req
                .header("User-Agent", OFFICIAL_UA)
                .header("Accept", "application/json")
                .header("sdk-version", "2")
                .header("lc", "101")
                .header("passport-sdk-version", "5051451")
                .header("x-tt-store-region", "cn-zj")
                .header("x-tt-store-region-src", "did")
                .header("x-ss-req-ticket", &ticket)
                .header("x-reading-request", &reading)
                .header("x-khronos", khronos.to_string())
                .header("x-ladon", &ladon)
                .header("x-argus", &argus)
                .header("x-gorgon", &gorgon)
                .header("cookie", &cookie);
            if let Some(ref b) = body {
                req = req
                    .header("Content-Type", "application/json; charset=utf-8")
                    .body(b.clone());
            }
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let text = resp.text().await.unwrap_or_default();
                    return Ok((status, text));
                }
                Err(e) => last_err = format!("请求番茄官方 API 失败: {e}"),
            }
        }
        Err(last_err)
    }

    pub async fn search(&mut self, query: &str) -> Result<Vec<OfficialSearchHit>, String> {
        self.ensure().await?;
        let extra = [
            ("query", query),
            ("offset", "0"),
            ("count", "20"),
            ("search_source", "1"),
            ("user_is_login", "0"),
        ];
        let (_status, text) = self.signed_request("GET", PATH_SEARCH, &extra, None).await?;
        parse_search_hits(&text)
    }

    pub async fn directory(&mut self, book_id: &str) -> Result<OfficialBook, String> {
        self.ensure().await?;
        let extra = [("book_id", book_id), ("need_version", "1")];
        let (_status, text) = self
            .signed_request("GET", PATH_DIRECTORY, &extra, None)
            .await?;
        parse_directory(&text, book_id)
    }

    pub async fn chapter(&mut self, book_id: &str, item_id: &str) -> Result<OfficialChapter, String> {
        self.ensure().await?;
        let extra_full = [("book_id", book_id), ("item_id", item_id)];
        let (_status, text) = self
            .signed_request("GET", PATH_READER_FULL, &extra_full, None)
            .await?;
        match parse_chapter(&text, item_id, self.content_key.as_deref()) {
            Ok(ch) if !ch.content.is_empty() && ch.content != "Invalid" => return Ok(ch),
            Ok(ch) if ch.content == "Invalid" => {
                self.content_key = None;
                self.register_key().await?;
            }
            Err(_) | Ok(_) => {}
        }
        let extra_batch = [("book_id", book_id), ("item_ids", item_id)];
        let (_status, text) = self
            .signed_request("GET", PATH_BATCH_FULL, &extra_batch, None)
            .await?;
        let ch = parse_chapter(&text, item_id, self.content_key.as_deref())?;
        if ch.content == "Invalid" {
            self.content_key = None;
            self.register_key().await?;
            let (_status, text) = self
                .signed_request("GET", PATH_BATCH_FULL, &extra_batch, None)
                .await?;
            return parse_chapter(&text, item_id, self.content_key.as_deref());
        }
        Ok(ch)
    }
}

fn device_cache_path() -> PathBuf {
    if let Ok(p) = std::env::var("FANQIE_DEVICE_CACHE") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".cache/liuliu-reader/fanqie_device.json")
}

fn load_device_cache() -> Option<DeviceCache> {
    let path = device_cache_path();
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn urlencoding_lite(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn parse_search_hits(text: &str) -> Result<Vec<OfficialSearchHit>, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("官方搜索响应不是 JSON: {e}"))?;
    let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 && code != -1 {
        return Err(format!(
            "官方搜索请求失败: code={code} msg={}",
            v.get("message").and_then(|m| m.as_str()).unwrap_or("?")
        ));
    }
    let mut hits = Vec::new();
    let mut stack = vec![v.get("data").cloned().unwrap_or(v)];
    while let Some(cur) = stack.pop() {
        match cur {
            Value::Array(arr) => stack.extend(arr),
            Value::Object(map) => {
                let book_id = map
                    .get("book_id")
                    .or(map.get("bookId"))
                    .and_then(|x| x.as_str().map(|s| s.to_string()).or_else(|| x.as_u64().map(|n| n.to_string())));
                if let Some(book_id) = book_id {
                    if book_id.len() >= 10 {
                        hits.push(OfficialSearchHit {
                            book_id,
                            title: json_first_string(&Value::Object(map.clone()), &["book_name", "bookName", "title"])
                                .unwrap_or_else(|| "未命名".into()),
                            author: json_first_string(&Value::Object(map.clone()), &["author", "authorName"])
                                .unwrap_or_else(|| "未知作者".into()),
                            cover_url: json_first_string(
                                &Value::Object(map.clone()),
                                &["thumb_url", "thumbUrl", "cover_url", "cover"],
                            ),
                            description: json_first_string(&Value::Object(map.clone()), &["abstract", "description"]),
                        });
                    }
                }
                stack.extend(map.into_values());
            }
            _ => {}
        }
    }
    hits.truncate(20);
    if hits.is_empty() {
        return Err("官方搜索没有返回书籍".into());
    }
    Ok(hits)
}

fn parse_directory(text: &str, book_id: &str) -> Result<OfficialBook, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("官方目录响应不是 JSON: {e}"))?;
    let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 && code != -1 {
        return Err(format!(
            "官方目录请求失败: code={code} msg={}",
            v.get("message").and_then(|m| m.as_str()).unwrap_or("?")
        ));
    }
    let data = v.get("data").cloned().unwrap_or(v.clone());
    let book_info = data.get("book_info").cloned().unwrap_or(data.clone());
    let mut chapters = Vec::new();
    if let Some(list) = data.get("item_data_list").and_then(|x| x.as_array()) {
        for item in list {
            let id = json_first_string(item, &["item_id", "itemId"]).unwrap_or_default();
            if id.len() >= 10 {
                chapters.push((
                    id,
                    json_first_string(item, &["title"]).unwrap_or_else(|| "正文章节".into()),
                ));
            }
        }
    }
    if chapters.is_empty() {
        return Err("官方目录响应没有章节".into());
    }
    Ok(OfficialBook {
        book_id: book_id.to_string(),
        title: json_first_string(&book_info, &["book_name", "bookName", "title"])
            .unwrap_or_else(|| format!("番茄小说_{book_id}")),
        author: json_first_string(&book_info, &["author", "authorName"]).unwrap_or_else(|| "网络作者".into()),
        cover_url: json_first_string(&book_info, &["thumb_url", "thumbUrl", "cover_url"]),
        description: json_first_string(&book_info, &["abstract", "description"]),
        chapters,
    })
}

fn parse_chapter(text: &str, item_id: &str, content_key: Option<&[u8]>) -> Result<OfficialChapter, String> {
    if text.trim().is_empty() {
        return Err("官方正文返回空响应".into());
    }
    let v: Value = serde_json::from_str(text).map_err(|e| format!("官方正文响应不是 JSON: {e}; {}", &text[..text.len().min(180)]))?;
    let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
    if code != 0 && code != -1 {
        return Err(format!(
            "官方正文请求失败: code={code} msg={}",
            v.get("message").and_then(|m| m.as_str()).unwrap_or("?")
        ));
    }
    let data = v.get("data").cloned().unwrap_or(v);
    let item = data
        .get(item_id)
        .cloned()
        .or_else(|| json_walk_item_id(&data).cloned())
        .unwrap_or(data);
    let title = json_first_string(&item, &["title", "chapter_title"]).unwrap_or_default();
    let raw = json_first_string(&item, &["content", "origin_content", "originContent"]).unwrap_or_default();
    if raw.is_empty() {
        return Err("官方正文返回空响应".into());
    }
    if raw == "Invalid" {
        return Ok(OfficialChapter {
            title,
            content: "Invalid".into(),
        });
    }
    let crypt = item
        .get("crypt_status")
        .or(item.get("cryptStatus"))
        .and_then(|x| x.as_i64())
        .unwrap_or(-1);
    let compress = item
        .get("compress_status")
        .or(item.get("compressStatus"))
        .and_then(|x| x.as_i64())
        .unwrap_or(0);
    let html = decode_official_body(&raw, content_key, crypt, compress)?;
    Ok(OfficialChapter { title, content: html })
}

fn decode_official_body(
    raw: &str,
    content_key: Option<&[u8]>,
    crypt_status: i64,
    compress_status: i64,
) -> Result<String, String> {
    let looks_b64 = raw.len() > 24 && raw.bytes().all(|b| b.is_ascii() && !b.is_ascii_whitespace());
    if let Some(key) = content_key {
        if looks_b64 && (crypt_status <= 0 || crypt_status == 1 || raw.len() % 4 == 0) {
            if let Ok(html) = decrypt_chapter_content(raw, key) {
                return Ok(html);
            }
            if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(raw) {
                if decoded.len() >= 17 {
                    if let Ok(html) = decrypt_chapter_content(raw, key) {
                        return Ok(html);
                    }
                }
            }
        }
    }
    if compress_status > 0 {
        if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(raw) {
            if let Ok(plain) = decompress_auto(&decoded) {
                return Ok(String::from_utf8_lossy(&plain).into_owned());
            }
        }
        if let Ok(plain) = decompress_auto(raw.as_bytes()) {
            return Ok(String::from_utf8_lossy(&plain).into_owned());
        }
    }
    Ok(raw.to_string())
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

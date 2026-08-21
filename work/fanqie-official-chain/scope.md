# Case Scope

## meta
- case_id: fanqie-official-chain
- created: 2026-08-21T21:25:20+08:00
- operator: local
- project_root: /Users/kuangqie/liuliu-reader
- primary_skill: apk-reverse/SKILL.md
- primary_id: R1
- lead_role: lead
- specialist_roles: []
- hint: offline APK reverse of Fanqie downloader + authorized probe of fqnovel official APIs with reconstructed x-ladon; integrate into FanqieClient::chapter
- preset: offline-sample

## auth
- status: granted
- basis: own_system
- evidence_of_auth: preset:offline-sample (owner-operated local file)
- MUST NOT proceed if status != granted

## in_scope
- assets:
  - /Users/kuangqie/Downloads/番茄。器_.apk
  - https://api5-normal-sinfonlinec.fqnovel.com
  - https://api5-normal-lf.fqnovel.com
  - https://api5-normal-hl.fqnovel.com
  - https://api5-normal.fqnovel.com
  - https://log.snssdk.com/service/2/device_register/
  - https://fanqienovel.com
  - https://changdunovel.com
- surfaces: [apk, native-so, official-http-api]
- activities: [static-reverse, signature-replay, authorized-api-probe, client-integration]

## out_of_scope
- assets: [unrelated bytedance products, third-party user accounts]
- activities: [dos, phishing_real_users, unrestricted_exfil, mass-download-abuse]

## network_profile
- mode: authorized_target_only
- notes: |
    Owner-operated local APK sample plus user-requested live probe of
    Fanqie/fqnovel official reading APIs already reconstructed from that sample.
    Only in_scope hosts. No DoS, no credential stuffing, no unrelated products.

## deliverables
- report: true
- field_journal: true
- diagrams: true
- timeline: true

## constraints
- timebox: {}
- stealth: low
- data_handling: anonymize

## signoff
- ready_for_act: true
- checklist:
  - [x] auth.status = granted
  - [x] in_scope.assets non-empty OR offline sample path set
  - [x] network_profile.mode chosen
  - [ ] out_of_scope reviewed
  - [ ] roles assigned (see skills/ops/role-map.md)

## ops_refs
- skills/ops/scope-contract.md
- skills/ops/evidence-finding-path.md
- skills/ops/role-map.md
- skills/ops/timeline-workitem.md
- skills/ops/IDENTITY.md

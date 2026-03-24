---
"@0xbigboss/silo": patch
---

Fix port allocator to check both `0.0.0.0` and `127.0.0.1` for availability, preventing "address already in use" errors when another silo instance binds a port on loopback only

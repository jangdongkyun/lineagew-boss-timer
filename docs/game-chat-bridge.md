# LINEAGE W Game Chat Bridge

This bridge is the server-side receiver for OCR clients that read only the visible in-game clan chat. It does not read game memory, game files, or network packets.

## Supported commands

- `컷 <boss name or alias> HH:mm`: creates a cut record.
- `취소 <boss name or alias> HH:mm`: marks the exactly matching active cut record for the same boss, server, Seoul date, and minute as pending deletion for 10 minutes. This matches the existing app's undo window and keeps history.

Commands are strict. Ordinary chat is ignored. Unknown/ambiguous boss names, invalid times, unmapped game nicknames, missing records, and duplicates do not alter a timer.

## Edge Function

Function slug: `game-chat-bridge`

URL: `https://jswekbrsjkylrwhgvvre.supabase.co/functions/v1/game-chat-bridge`

### Register a device

POST JSON body:
```json
{
  "action": "register_device",
  "platform": "android",
  "device_name": "Galaxy phone",
  "server_id": 1
}
```

Send the logged-in member's Supabase access token as `Authorization: Bearer <access-token>`. Supported platforms: `android`, `windows`. A one-time 256-bit device token is returned. Store it securely on that device; only its SHA-256 hash is stored in the database.

### Send an OCR result

POST JSON body:
```json
{
  "action": "ingest",
  "source_message_id": "stable-id-from-the-chat-row",
  "game_nickname": "character-name-shown-in-chat",
  "message": "컷 가스트 20:35",
  "message_at": "2026-11-28T20:35:00+09:00"
}
```

Send the registered device token in the `x-device-token` header. The OCR client must supply a stable `source_message_id` for each visible chat row so repeated screen scans are idempotent. `message_at` is the in-game message timestamp (or capture time if the game does not show one), within the last seven days.

### Member identity mapping

Each member connects their in-game character nickname to their own approved BoTamBot account in the app's **채팅 자동인식** settings. The mapping is server-specific. The OCR client sends the author name shown beside the clan-chat message; the server resolves it to the member UUID before writing a cut record.

## Database objects

- `chat_capture_devices`: registered device and hashed token.
- `game_chat_member_mappings`: server-specific in-game nickname to member mapping.
- `game_chat_command_logs`: command processing audit.
- `process_game_chat_command(...)`: service-role-only atomic operation that uses existing cut-record triggers/history.

The Edge Function validates device tokens and member status. The service-role key is never sent to clients.

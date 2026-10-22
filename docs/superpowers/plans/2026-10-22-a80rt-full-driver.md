# A80RT Full Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng Reader 0.2 thành công cụ cấu hình đầy đủ cho A80RT / A80RT U, gồm đầu thu 2.4 GHz của người dùng, với luồng chỉnh → áp dụng → đọc lại.

**Architecture:** Giữ web app và WebHID browser-local. Tách transport, capability/codec theo mẫu, giao dịch bản gốc/bản nháp và các view. Đây là một kế hoạch tích hợp vì mọi chức năng cùng sửa các vùng cấu hình và dùng chung hàng đợi giao tiếp; không tách thành các app hoặc dự án độc lập.

**Tech Stack:** JavaScript ES modules, HTML/CSS hiện có, WebHID, Node.js `node:test`, Sites cho HTTPS và quyền truy cập riêng tư; không thêm framework hoặc backend cấu hình.

**Spec:** `docs/superpowers/specs/2026-10-22-a80rt-full-driver-design.md` — người dùng đã duyệt bằng “k” ngày 22/10/2026.

## Global Constraints

- “Làm đầy đủ như web gốc” là phạm vi; thứ tự thực hiện không thu hẹp về chỉ RT/remap/RGB.
- Giữ app browser-local, JavaScript modules buildless và WebHID; giao diện tiếp tục tiếng Việt.
- Đích thực tế: A80RT U Dongle `0x0C45:0xFEFC`, usage page `0xFF80`, usage `1`, input/output ID `0`, report `32` byte.
- Bản có dây: `0x0C45:0x80A1` và `0x0C45:0x80A2`; không suy ra mẫu chỉ từ PID dùng chung.
- Đọc dữ liệu thực trước khi bật chỉnh sửa thiết bị; không ghi cấu hình mặc định thay cho vùng đọc thiếu.
- Mọi byte chưa giải mã phải giữ nguyên. Không giả định ACK ghi có cùng payload với phản hồi đọc.
- Không tự ghi sau mỗi sự kiện slider. Chỉ báo “Đã áp dụng” khi đọc lại khớp trường đã thay đổi.
- Không tự đổi thông số chơi game của người dùng để tạo bằng chứng; phép thử phần cứng dùng thay đổi người dùng chọn.
- Firmware và dịch vụ riêng của hãng có trạng thái/phụ thuộc rõ ràng; không báo đã flash khi chỉ mở công cụ hãng.
- Giữ cùng Site `appgprj_6ad986b9194881919dabff371f4f766f`, URL hiện tại và quyền riêng tư. Dùng workflow Sites cho mở source, push, đóng gói và deploy.

## Review Focus

1. Đầu thu mở được nhưng bàn phím ngủ/không trả lời: trạng thái phải là “kết nối, chưa đọc được”, không mở bộ ghi; Task 1 kiểm tra.
2. Phiên đọc cũ trả lời sau khi người dùng kết nối thiết bị khác: không gán dữ liệu cũ vào thiết bị mới; Task 1 kiểm tra.
3. Import/profile của mẫu khác hoặc cấu hình thiếu byte: từ chối áp dụng, giữ nguyên vùng gốc và không gửi lệnh; Task 7 kiểm tra.
4. ACK đúng nhưng đọc lại không khớp, hoặc mất kết nối giữa hai nhóm ghi: báo chưa xác nhận, giữ bản nháp và liệt kê nhóm đã gửi; Task 3 kiểm tra.
5. Xóa macro đang được Fn/phím nâng cao tham chiếu hoặc chọn nhiều phím có giá trị khác nhau: không tạo con trỏ treo và không ghi đè bằng giá trị hiển thị chung giả; Tasks 4–5 kiểm tra.

## File map và hợp đồng dùng chung

- `dist/device/transport.js`: một phiên WebHID, trace, hàng đợi, read/control/write theo bằng chứng.
- `dist/device/capabilities.js`: nhận diện mẫu/transport, nhóm hỗ trợ, giới hạn và các khả năng chưa xác minh.
- `dist/device/protocol-facts.json`: bảng lệnh/trường/ACK kèm vị trí tham chiếu; phân biệt suy từ mã và đo thực tế.
- `dist/config/codecs.js`: codecs thuần cho RT, keymap/Fn, settings và RGB, giữ reserved bytes.
- `dist/config/macros.js`, `dist/config/advanced.js`: format macro, RS/SOCD/DKS/MT/TGL và tham chiếu chéo.
- `dist/config/session.js`: snapshot gốc, draft, changed fields, validation và trạng thái giao dịch.
- `dist/config/profiles.js`: lưu/nhập/xuất profile theo model và schema.
- `dist/ui/core-editors.js`, `dist/ui/advanced-editors.js`, `dist/ui/device-settings.js`: form và tương tác từng nhóm.
- `dist/app.js`, `dist/index.html`, `dist/styles.css`: composition, điều hướng tab, sơ đồ và trạng thái toàn app.
- `dist/protocol.js`: giữ các export cũ bằng facade khi chuyển transport; tránh phá bản JSON v1 và 12 bài kiểm tra hiện tại.
- `tests/fixtures/`: fixture nguồn/thiết bị với nhãn provenance; không gọi dữ liệu sinh tổng hợp là capture thật.
- `tests/*.test.mjs`: transport, codec, giao dịch, profile và luồng cấu hình; test utilities nằm riêng.

Hợp đồng:

```text
DeviceIdentity = {vendorId, productId, productName, transport, model}
Snapshot = {identity, blocks: Record<string, Uint8Array>, coverage, provenance}
Change = {block, path, before, after, byteOffsets: number[]}
Capability = {identity, blocks, fields, limits, features, firmware: {status, officialUrl}}
ApplyResult = {status: 'verified'|'unconfirmed'|'failed', writtenBlocks, verifiedFields, error?}
```

Không chuyển thành kiểu TypeScript hoặc thêm runtime schema library; dùng JSDoc và hàm kiểm tra trong ES modules.

---

### Task 1: Xác minh và sửa đường đọc trên đầu thu thật

**Files:** Create `dist/device/transport.js`, `tests/transport.test.mjs`, `tests/fixtures/a80rt-dongle-descriptor.json`, `docs/protocol/read-investigation.md`; modify `dist/protocol.js`, `dist/app.js`.

**Interfaces:**
- Consumes: các export hiện có trong `dist/protocol.js`, JSON chẩn đoán thực tế `C:/Users/Administrator/Downloads/a80rt-read-2026-10-22T04-14-25-963Z.json` và bundle tham chiếu trong `work/a80rt-inspect/app.js` ngoài repo.
- Produces: `A80Transport(device, {onTrace, timeoutMs})`, `open(): Promise<void>`, `readBlock(command, length, {signal}): Promise<Uint8Array>`, `close(): Promise<void>`; `getState()` trả `opened`, `hasResponse`, `sessionId`.

- [ ] **1. Điều tra trước sửa:** tái hiện lỗi đọc `0x10` ở offset 0; so sánh cùng thiết bị, cùng report descriptor và cùng lệnh trên driver hãng. Kiểm tra trạng thái ngủ, tab/ứng dụng chiếm giao diện và thời điểm ACK. Ghi trace thực tế vào `read-investigation.md`; không thêm lệnh wake/khởi tạo khi chưa có tham chiếu.
- [ ] **2. Viết test thất bại từ khác biệt đã xác định:** tên test nêu nguyên nhân cụ thể; fixture ghi rõ nguồn. Thêm các ca: mở được nhưng không RX thì `hasResponse === false`; một frame cũ sau `close/open` không hoàn tất request mới; offset sai/khối thiếu không được ghép thành cấu hình đủ.
- [ ] **3. Chạy RED:** `node --test tests/transport.test.mjs`; phải thất bại đúng hành vi thiếu, không do import sai. Ghi lại tên ca và lỗi mong đợi.
- [ ] **4. Cài transport tối thiểu:** listener theo phiên, hàng đợi và timeout theo bằng chứng; báo đúng ranh giới opened/ready. Facade giữ các export công khai cũ; không đổi thông số RT hoặc phát lệnh ghi trong task này.
- [ ] **5. Chạy GREEN:** `npm test` phải không có bài thất bại; trên thiết bị thật thu được RX cho `0x10` và các khối Reader hiện có. Nếu chưa có RX, tiếp tục điều tra hoặc báo đúng điều kiện cần người dùng; không đánh dấu task đạt phần cứng và không mở chức năng ghi.
- [ ] **6. Commit:** chỉ các file task, thông điệp `fix: qualify A80RT reads over the wireless receiver`.

### Task 2: Capability và codecs giữ nguyên dữ liệu gốc

**Files:** Create `dist/device/capabilities.js`, `dist/device/protocol-facts.json`, `dist/config/codecs.js`, `tests/codecs.test.mjs`, `tests/capabilities.test.mjs`, fixtures cho các nhóm gốc.

**Interfaces:**
- Consumes: descriptor/trace Task 1, `LAYOUT` và `KEYS` trong `dist/layout.js`.
- Produces: `identifyDevice(descriptor): Capability`; `decodeBlock(blockId, raw, capability): object`; `patchBlock(blockId, raw, edits, capability): {bytes, changes: Change[]}`; `readPlan(capability): {id, command, length}[]`.

- [ ] **1. Lập bảng byte trước test:** truy vết đầy đủ bảng key type, mode RT, đơn vị, LED/settings, macro pointer và DKS từ đúng nhánh A80RT. Mỗi trường có offset, kiểu, giá trị hợp lệ, vùng reserved và nguồn trong `protocol-facts.json`. Kích thước macro lấy từ header/giới hạn được xác minh; không tự gán 1024 byte cho mọi thiết bị.
- [ ] **2. Viết test RED:** RT slot W `34`, raw threshold `80` giải mã `0.8 mm`; sửa thành `1.2 mm` chỉ đổi trường threshold ở `34*8+2..3`. Round-trip byte chứa reserved bits, slot Backspace `92` và PgDn `108` giữ nguyên; raw zero không tự đổi thành mặc định. Dongle không cho chỉnh polling nếu capability hãng tắt.
- [ ] **3. Chạy:** `node --test tests/codecs.test.mjs tests/capabilities.test.mjs`, xác nhận các chức năng mới chưa có nên test đỏ đúng nguyên nhân.
- [ ] **4. Cài các hàm thuần:** clone raw trước patch, kiểm tra giá trị và đối tượng field theo capability; trường chưa xác minh trả lỗi có tên trường thay vì đoán byte. `readPlan` bao phủ thông tin, settings, keymap, LED, màu từng phím, macro, Fn, RT và DKS khi mẫu hỗ trợ.
- [ ] **5. Chạy `npm test`:** chứng minh round-trip bằng byte-for-byte và tập byte thay đổi đúng whitelist; fixture synthetic và capture thật không bị trộn.
- [ ] **6. Commit:** `feat: add model-aware A80RT configuration codecs`.

### Task 3: Bản nháp và giao dịch áp dụng có đọc lại

**Files:** Create `dist/config/session.js`, `tests/session.test.mjs`; modify `dist/device/transport.js`, `dist/device/protocol-facts.json` và facade `dist/protocol.js`.

**Interfaces:**
- Consumes: `Capability`, codec và `A80Transport`.
- Produces: `ConfigSession(snapshot, capability)`, `edit(blockId, edits): Change[]`, `revert(): void`, `diff(): Change[]`, `apply(transport, {signal, onProgress}): Promise<ApplyResult>`; transport thêm `writeBlock(command, bytes, {signal})`, `sendControl(command, payload, {signal})` theo format đã xác minh.

- [ ] **1. Ghi bằng chứng ACK:** đối chiếu các lệnh `0x21..0x28` với từng nhóm, ACK ghi và bước `0x00`. Xác định bằng code/trace ý nghĩa commit và cách xác nhận; không mặc định ACK ghi chứa lại payload đọc.
- [ ] **2. Viết test RED:** edit không đụng snapshot; revert khôi phục nguyên byte; chỉ nhóm thay đổi được ghi; ACK sai hoặc đọc lại lệch không trả `verified`; mất kết nối sau nhóm 1 giữ danh sách đã gửi và draft; hai lần apply đồng thời bị chặn. Unknown opcode từ dữ liệu nhập không phát ra transport.
- [ ] **3. Chạy:** `node --test tests/session.test.mjs`, xác nhận thiếu cơ chế giao dịch là nguyên nhân thất bại.
- [ ] **4. Cài session và writer:** serialize từng request, kiểm tra nguồn snapshot/coverage, patch vùng đầy đủ, gửi nhóm đổi rồi commit nếu đã xác minh. Đọc lại và so sánh **các trường cấu hình đã đổi**, không so firmware clock/pin hoặc trường volatile. Không retry mù lệnh reset/firmware.
- [ ] **5. Chạy `npm test`:** test giữ byte gốc, không ghi khi thiếu dữ liệu và không báo thành công giả phải xanh. Phép thử thực tế để riêng: chỉ thực hiện thay đổi thông số do người dùng chọn; ghi kết quả read-back và reconnect trước khi tuyên bố lưu vĩnh viễn.
- [ ] **6. Commit:** `feat: apply A80RT drafts with read-back verification`.

### Task 4: Màn hình RT, remap/Fn và RGB có chỉnh thật

**Files:** Create `dist/ui/core-editors.js`, `tests/core-editors.test.mjs`; modify `dist/app.js`, `dist/index.html`, `dist/styles.css`.

**Interfaces:**
- Consumes: `ConfigSession`, `Capability`, layout và các codec đã xác minh.
- Produces: `mountCoreEditors(root, {session, capability, selectedSlots, onEdit}): {setSelection(slots), destroy()}`; thay đổi chỉ gọi `session.edit`, nút Apply toàn app gọi Task 3.

- [ ] **1. Viết test RED cho view model thuần:** chọn W/A có giá trị khác nhau trả mixed, không tự áp giá trị một phím cho nhóm; chỉnh lớp Fn không sửa keymap mặc định; chọn switch cập nhật giới hạn hợp lệ; RGB từng phím không đổi màu phím ngoài vùng chọn. Khi chỉ opened/chưa snapshot thì editing và Apply bị khóa.
- [ ] **2. Chạy:** `node --test tests/core-editors.test.mjs`; lỗi phải là view model chưa có, không do môi trường DOM.
- [ ] **3. Cài UI:** tab RT, Remap và RGB; single/multi/all selection; điều khiển số/slider có đơn vị đã xác minh; bộ chọn phím/media/modifier; Fn đúng khả năng; hiệu ứng, màu, sáng/tốc độ/hướng và RGB từng phím/vùng. Hiện số thay đổi, Revert và Apply; không autosend slider.
- [ ] **4. Chạy `npm test`, rồi QA trình duyệt bằng CUA:** sample có thể chỉnh để thử UI nhưng không có thiết bị; thay đổi lớp, chọn nhiều phím, validation và Revert phải phản ánh cùng session. Không tạo nút giả cho hiệu ứng cần helper hãng; ghi phụ thuộc rõ.
- [ ] **5. Commit:** `feat: add editable RT remapping and RGB panels`.

### Task 5: Macro và RS/SOCD/DKS/MT/TGL

**Files:** Create `dist/config/macros.js`, `dist/config/advanced.js`, `dist/ui/advanced-editors.js`, `tests/macros.test.mjs`, `tests/advanced.test.mjs`; modify `dist/app.js`, `dist/index.html`, `dist/styles.css`.

**Interfaces:**
- Consumes: Task 2 key types, dung lượng/pointer layout và Task 3 session.
- Produces: `decodeMacros(raw, capability): Macro[]`, `patchMacros(raw, macros, capability): {bytes, referenceChanges}`; `patchAdvanced(blocks, binding, capability): {blocks, changes}`; `validateReferences(blocks, macros, capability): string[]`; `mountAdvancedEditors(root, context): {destroy()}`.

- [ ] **1. Viết test RED:** macro delay/key down/up/lặp round-trip đúng; quá dung lượng và pointer ra ngoài vùng bị từ chối; xóa macro đang được base/Fn/advanced tham chiếu buộc sửa tham chiếu cùng giao dịch hoặc chặn; RS/SOCD không cho cùng một phím ở hai vị trí; DKS giữ thứ tự hành trình và giới hạn mẫu; MT/TGL không ghi đè reserved bytes.
- [ ] **2. Chạy:** `node --test tests/macros.test.mjs tests/advanced.test.mjs` và kiểm tra fail đúng chức năng chưa có.
- [ ] **3. Cài codec và editor:** tạo/sửa/xóa macro; action timeline và chế độ lặp; nút bắt đầu/dừng ghi rõ ràng, listener recorder chỉ tồn tại khi người dùng bật và trang đang focus. Thêm đủ RS, SOCD, DKS, MT, TGL và gán cho phím/lớp Fn theo capability; mô tả ngắn và validation quan hệ giữa các phím.
- [ ] **4. Chạy `npm test`, QA trình duyệt:** tạo và gán macro, sửa/xóa có tham chiếu, chuyển tab khi recorder bật phải dừng thu và tháo listener. Khi Apply lỗi, dữ liệu nhập không mất.
- [ ] **5. Commit:** `feat: add macro and advanced key configuration`.

### Task 6: Thiết lập, hiệu chuẩn, khôi phục và đường cập nhật chính thức

**Files:** Create `dist/ui/device-settings.js`, `tests/device-settings.test.mjs`; modify capability, codecs, app và HTML/CSS.

**Interfaces:**
- Consumes: capability settings, transport control format đã xác minh, session.
- Produces: `settingsView(capability, snapshot): {fields, actions}`; `runDeviceAction(action, {transport, capability, onProgress, signal}): Promise<{status, requiresReload}>`; `mountDeviceSettings(root, context): {destroy()}`.

- [ ] **1. Viết test RED:** polling không hiện trên dongle nếu không hỗ trợ; thiết lập OS/ngủ/ổn định/calibration chỉ patch đúng offset; hủy hiệu chuẩn luôn gửi thao tác kết thúc đã xác minh, kể cả đổi tab; reset không dùng chung với apply. Firmware sai model bị từ chối và công cụ ngoài không được báo là đã flash trong app.
- [ ] **2. Chạy:** `node --test tests/device-settings.test.mjs`; xác nhận fail đúng hành vi thiếu.
- [ ] **3. Cài UI/action:** firmware/pin khi có dữ liệu, settings theo mẫu, hiệu chuẩn có hướng dẫn và kết thúc/hủy, khôi phục có phạm vi rõ. Reset làm hết hiệu lực snapshot và đọc lại. Firmware hiện trạng thái xác minh và mở nguồn/công cụ chính thức đúng mẫu; chỉ thêm flash trực tiếp khi có luồng, kiểm tra model/image và trace đã được kiểm chứng, nếu không giữ nhãn chưa hỗ trợ trực tiếp.
- [ ] **4. Chạy `npm test`, QA luồng hủy và mất kết nối:** không tự reset hoặc nâng firmware của người dùng để kiểm thử. Thu kết quả thực tế chỉ cho thao tác người dùng chọn.
- [ ] **5. Commit:** `feat: add model-specific device settings and maintenance`.

### Task 7: Profile cục bộ, nhập/xuất và phục hồi phiên

**Files:** Create `dist/config/profiles.js`, `tests/profiles.test.mjs`; modify app, UI và README.

**Interfaces:**
- Consumes: identity, capability, Snapshot/Change và session Task 3.
- Produces: `saveProfile(profile, storage): Promise<string>`, `listProfiles(identity, storage): Promise<Profile[]>`, `parseProfile(json, capability): Profile`, `loadProfile(profile, session): Change[]`, `exportProfile(profile): string`. Storage là IndexedDB browser-local, có adapter in-memory cho test.

- [ ] **1. Viết test RED:** round-trip profile đúng model; từ chối khác model, schema lạ, byte ngoài 0..255, thiếu vùng cấu hình hoặc macro pointer lỗi; v1 JSON cũ mở được để xem nhưng không tự biến thành profile đầy đủ; hết quota báo lỗi và không mất bản hiện tại. Import demo không mở thiết bị hay gửi gói.
- [ ] **2. Chạy:** `node --test tests/profiles.test.mjs`; xác nhận fail đúng nguyên nhân.
- [ ] **3. Cài lưu/nhập/xuất/chuyển profile:** preview diff rồi vào session draft; không chuyển profile bằng lệnh firmware không được xác minh. Đặt tên, nhân bản, xóa profile cục bộ và khôi phục sau reload. Chia sẻ/đám mây hãng là phụ thuộc ngoài được ghi rõ, không thêm backend giả hoặc tài khoản mới.
- [ ] **4. Chạy `npm test`, QA reload/import/export:** test file round-trip và các ca JSON lỗi; giữ nhãn sample/thiết bị/đã lưu rõ ràng.
- [ ] **5. Commit:** `feat: add device-scoped local configuration profiles`.

### Task 8: Đối chiếu toàn bộ, rà độc lập và triển khai

**Files:** Create `docs/feature-parity.md`; modify `README.md`, `package.json`, module cache versions; package source ZIP vào thư mục outputs của chat.

**Interfaces:**
- Consumes: mọi task trên, Site manifest hiện có, kết quả phần cứng và mô phỏng.
- Produces: bảng từng tính năng với nhãn kiểm tra thật / mô phỏng / phụ thuộc hãng, bản app mới trên cùng URL riêng tư, ZIP source cập nhật.

- [ ] **1. Kiểm tra coverage spec từng hàng:** bao gồm RT, remap/Fn, macro, RGB, mọi advanced mode, profile, settings, calibration/reset/firmware và diagnostics. Tính năng phụ thuộc công cụ hãng có nhãn và đường đi sử dụng; không tính nút trống là hoàn thành.
- [ ] **2. Chạy `npm test` và `node --check` cho từng module sửa:** ghi số pass/fail thực tế. Thực hiện whole-branch review độc lập theo phương thức execution đã chọn; xử lý mọi lỗi nghiêm trọng rồi kiểm tra lại phần sửa.
- [ ] **3. QA CUA:** kết nối, đọc, draft/apply/read-back, lỗi giữa chừng, sample, import/export và viewport hẹp. Lưu ảnh kết quả thật; không dùng ảnh sample làm bằng chứng USB. Phần cứng chỉ được ghi test với thay đổi người dùng chỉ định.
- [ ] **4. Dùng workflow Sites:** đọc manifest, get_site kiểm tra quyền, lấy credential giữ trong memory, source helper mở và đóng gói đúng HEAD đã push. Deploy đúng cùng Site, đợi thành công và mở URL; không tạo Site khác hoặc đổi audience.
- [ ] **5. Xuất ZIP:** chỉ source cần dùng, README, tests và bằng chứng khả năng; loại token, `.git`, runtime và trace riêng không cần thiết. File ở `C:/Users/Administrator/Documents/Codex/2026-10-22/c/outputs/`.
- [ ] **6. Báo đúng kết quả:** những nhóm đã làm, kiểm tra nào đã chạy thật, những khả năng vẫn phụ thuộc hãng hoặc cần thêm kiểm chứng. Nếu một yêu cầu không đạt, tiếp tục hoặc báo blocker cụ thể thay vì gọi là driver đầy đủ.

## Self-review của kế hoạch

- Tất cả nhóm trong spec có task sở hữu: transport/diagnostics (1), codecs/capability (2), apply/read-back (3), RT/remap/Fn/RGB (4), macro/advanced (5), settings/maintenance (6), profile (7), UI và publication (8).
- Năm Review Focus đều có test nêu rõ trong task tương ứng.
- Các tên `A80Transport`, `ConfigSession`, `patchBlock`, `Capability`, `Snapshot`, `Change`, `ApplyResult` dùng thống nhất xuyên task.
- Phần chưa có bằng chứng là việc điều tra được chỉ định ở Tasks 1–3; không biến opcode/đơn vị đoán thành yêu cầu giao thức.
- Trình tự thực hiện tích hợp; có thể tách lượt rà nhưng không giao các task cùng sửa schema cho nhiều người đồng thời.

## Execution đề xuất

**Native — người triển khai chính làm từng task, sau đó một lượt reviewer độc lập rà toàn bộ.** Lý do: các task phụ thuộc chặt vào cùng giao thức, capability và dữ liệu gốc; cách này giảm lệch hợp đồng và số lượt bàn giao. Phương án subagent-driven vẫn phù hợp nếu người dùng muốn kiểm tra độc lập sau từng task và chấp nhận thêm lượt triển khai/rà soát.

Người dùng đã duyệt kế hoạch và chọn “Dùng subagent triển khai và rà soát riêng từng phần” ngày 22/10/2026. Thực hiện theo subagent-driven-development, không hỏi lại giữa các task.

# A80RT Configurator — 0.3.5

Ứng dụng WebHID cục bộ để đọc đủ 9 nhóm cấu hình LEOBOG A80RT / A80RT U, chỉnh bản nháp RT, gán phím, Fn, đèn, màu từng phím, macro, phím nâng cao và thiết lập chung. Dữ liệu thiết bị và hồ sơ cấu hình được xử lý trong trình duyệt. [Bảng đối chiếu tính năng](docs/feature-parity.md) ghi riêng chức năng triển khai, kiểm thử mô phỏng, bằng chứng phần cứng và các mục phụ thuộc hãng.

Bản 0.3.5: bỏ chọn macro vẫn giữ nguyên timeline chưa lưu, dừng ghi và khóa Xóa/Gán; Lưu tạo macro mới, chọn lại macro thật sẽ nạp nguồn đó. Đây là sửa trạng thái chọn cục bộ, không bổ sung kiểm chứng phần cứng.

Bản này cũng sửa lệch lớp sau lỗi RT; tái sử dụng an toàn vùng macro do phiên tạo khi lưu tăng dần; bảo vệ mẫu DKS của Fn khóa/vị trí không vật lý khi nhập hồ sơ; và ngăn kết quả đọc JSON cũ ghi đè phiên mới. Mẫu DKS dùng chung với vị trí phải giữ sẽ từ chối giao dịch thay mẫu, có lý do rõ. [Thiết kế và regression 0.3.5](docs/0.3.5-correctness.md) ghi vòng đời ownership và phạm vi bằng chứng.

## Sử dụng

1. Mở trang trực tiếp trong Chrome hoặc Edge trên máy tính. Nếu khung xem không cho phép USB, mở URL của trang trong tab trình duyệt riêng. Đóng tab driver hãng.
2. Chọn **Kết nối bàn phím**, rồi **Đọc cấu hình**. Chỉ sau khi đọc đủ 9 nhóm mới chỉnh được bản nháp. Không thay dữ liệu thiếu bằng cấu hình mặc định.
3. Chọn phím và chỉnh các mục cần thiết. Mọi thay đổi chỉ ở bản nháp; thanh trượt không tự gửi USB.
4. Với **A80RT U có dây, firmware 1.37**, giao diện input/output report ID0, 64 byte, usage FF68/61, bấm **Áp dụng** để gửi. **Ghi lớp Fn (0x26/38) chưa khả dụng theo phép đo trên đúng phạm vi này.** Bản nháp có thay đổi Fn sẽ khóa toàn bộ Áp dụng trước khi gửi bất kỳ nhóm nào; vẫn sửa, lưu/xuất hồ sơ, xuất JSON và hoàn tác cục bộ được. Bỏ thay đổi Fn để áp dụng các nhóm được hỗ trợ. Ứng dụng chỉ báo đã áp dụng khi đọc lại khớp các trường đã sửa. Nếu đã gửi mà ghi chưa được xác nhận, ứng dụng giữ bản nháp và lỗi, khóa chỉnh sửa/Áp dụng/Hoàn tác cho tới khi đọc mới đủ 9 nhóm. Có thể xuất JSON bản nháp trước khi đọc lại; số thay đổi cục bộ không chứng minh thiết bị đã khôi phục.
5. Dữ liệu mẫu và JSON mở lại chỉ dùng cho bản nháp cục bộ. Kể cả JSON có nhãn nguồn thiết bị và firmware phù hợp cũng không cấp quyền ghi. Sau khi kết nối lại cần đọc mới. A80RT, đầu thu 2.4 GHz, firmware/giao diện khác vẫn chưa mở ghi.
6. Xuất JSON để lưu bản đang xem hoặc bản nháp. Tệp có thể chứa cấu hình cá nhân và macro; tự chọn nơi lưu/chia sẻ. Nhật ký giữ tối đa 500 gói cấu hình, không ghi nội dung gõ phím thông thường.

Các mục hiệu chuẩn và khôi phục vẫn bị khóa do chưa đo được ACK bảo trì. Firmware chỉ mở web hãng, không flash trong ứng dụng; chọn đúng model khi dùng công cụ ngoài.

## RT và vùng chết toàn bàn phím

Trong **Rapid Trigger**, chọn một hoặc nhiều phím để chỉnh điểm nhận, ngưỡng nhấn/nhả và **RT trên toàn hành trình** (whole, bit 0). Theo mô tả hãng, bật whole để RT duy trì hoạt động; tắt để RT có hiệu lực sau khi phím đạt điểm nhận. Đây là ngữ nghĩa từ nguồn hãng, chưa phải kết quả đo hành vi riêng. Bottom Optimization (bit 1) và Rampage Mode (bit 2) vẫn đọc được trong dữ liệu gốc nhưng không có bộ chỉnh đã chứng minh áp dụng cho cả ba model A80RT; sửa cờ khác hoặc tải hồ sơ giữ nguyên hai bit này.

Trong **Thiết lập & bảo trì → Thiết lập**, A80RT, A80RT U và U Dongle có **Vùng chết phía trên/phía dưới · toàn bàn phím**: 0,00–0,50 mm, bước 0,01 mm. Đây là settings byte 8/9, độc lập vùng phím đang chọn; nhập số chỉ tạo bản nháp, bấm **Hoàn tác bản nháp** để bỏ. Số 0 và giá trị gốc chưa nhận diện được giữ nguyên cho tới khi bạn sửa đúng trường. Không suy ra một bit bật/tắt firmware riêng từ hai giá trị này.

Bộ chọn switch từng phím mở cho A80RT và A80RT U có dây theo điều kiện giao diện hãng; dongle ẩn theo timeValue; tên giữ theo bản dịch nguồn, ID lạ/hành trình lạ được hiển thị rõ và bảo toàn. Thay switch cần hiệu chuẩn bằng công cụ hãng, không đồng nghĩa ứng dụng đã hiệu chuẩn. Catalog A80RT PID80A2 và các gate render đã xác minh hỗ trợ chỉnh cục bộ whole/switch/vùng chết cùng giới hạn như U có dây. Đây là bằng chứng nguồn, không mở ghi cho 80A2. Với ID lạ chưa biết hành trình, sửa khoảng cách bị từ chối và bản nháp giữ nguyên; không đoán mặc định 3,4 mm. Dữ liệu mẫu là A80RT U tổng hợp, không phải dữ liệu USB.

Macro đang nhập được giữ nguyên khi Hoàn tác hoặc tải hồ sơ thay macro nguồn. Ghi bàn phím dừng; cần lưu lại hoặc chọn macro hiện tại trước khi gán. Lưu tiếp sau lần lưu thành công vẫn cập nhật macro đã chọn. Bốn bộ chọn phím DKS có **— Không dùng —** (usage0); mẫu mới vẫn mặc định phím A (usage4), MT/TGL không có lựa chọn0.

## Hồ sơ cục bộ và phục hồi

Trong **Hồ sơ cấu hình**, đặt tên rồi **Lưu bản nháp thành hồ sơ**. Hồ sơ được lưu trong IndexedDB của trình duyệt và phân theo đủ danh tính model, cổng kết nối, VID/PID và tên sản phẩm. Chọn hồ sơ để đổi tên, nhân bản, xóa hoặc xuất JSON v2. Mỗi lần lưu bản nháp tạo một hồ sơ mới. Đổi thư viện model để xem hồ sơ của model khác.

**Xem trước đã chọn**, **Nhập hồ sơ JSON** và **Khôi phục phiên gần nhất** luôn mở bản xem trước. Bấm **Đưa vào bản nháp** để xác nhận. Khi đã có phiên chỉnh sửa, chỉ các trường được hỗ trợ được chuyển trong một giao dịch nguyên tử; byte chưa giải mã ngoài bản ghi gán phím được thay, marker màu, bit dành riêng, thông tin thiết bị và Fn F1–F12 giữ theo bản nháp hiện tại. Thay gán phím rỗng/phím/chuột/media sở hữu đủ 4 byte và đặt byte cuối bằng 0 theo bộ mã hóa hãng; chức năng sở hữu đủ 4 byte mã chức năng. Bản ghi không sửa giữ nguyên. Liên kết macro/DKS/RS/SOCD được kiểm tra; lỗi giữ nguyên toàn bộ bản nháp. Hồ sơ khác model, thiếu một trong 9 vùng, byte sai hoặc con trỏ macro lỗi bị từ chối.

Xem trước liệt kê các trường chưa hỗ trợ bị bỏ qua, gồm bottom/rtMode và switch của dongle. Các trường này giữ giá trị hiện tại, kể cả bit từ hồ sơ cũ khác giá trị đang đọc. Mở hồ sơ khi chưa có phiên tạo baseline ngoại tuyến giữ nguyên byte đã lưu, kể cả giá trị gốc ngoài phạm vi editor, ID switch lạ hoặc byte Fn bị khóa; không tạo quyền ghi thiết bị. Khi kết nối, phiên ngoại tuyến được bỏ và cần đọc mới đủ 9 nhóm; đưa hồ sơ vào phiên hiện tại vẫn kiểm tra các thay đổi ngữ nghĩa, giữ byte opaque/Fn khóa hiện tại. Ví dụ độ sáng thay đổi phải trong 1–5; raw255 được giữ khi mở ngoại tuyến nhưng bị từ chối khi chuyển thành thay đổi độ sáng.

Hồ sơ có điểm nhận raw0 có thể xem trước và đưa lại giá trị đã lưu vào bản nháp sau khi sửa sang giá trị dương. Raw0 là giá trị được bảo toàn; chưa xác định ý nghĩa vật lý và không suy ra khoảng cách mặc định. Nhập điểm nhận thủ công vẫn tối thiểu 0,01 mm; tải hồ sơ chỉ sửa hai byte điểm nhận qua trường ngữ nghĩa hiện có, giữ nguyên byte khác và kiểm tra giao dịch/đọc lại.

Sau thay đổi hợp lệ, bản nháp được giữ cục bộ sau khoảng 350 ms; đợi thông báo **Đã giữ bản nháp để phục hồi sau tải lại** trước khi tải lại trang. Chọn thư viện model rồi **Khôi phục phiên gần nhất** để mở lại. Bản phục hồi mở ngoại tuyến; cần kết nối và đọc mới trước khi chuyển hồ sơ vào phiên thiết bị để áp dụng. Sự kiện macro còn ở trình nhập và chưa bấm **Lưu macro vào bản nháp** không thuộc bản phục hồi. Lỗi dung lượng/quyền lưu không xóa bản nháp đang mở hoặc bản lưu trước.

JSON v1 cũ vẫn chỉ để xem, kể cả đủ 9 vùng; nhãn nguồn/firmware trong tệp không tạo quyền ghi USB. Xuất hồ sơ không gửi dữ liệu đi đâu. Xóa dữ liệu trang hoặc đổi trình duyệt/origin sẽ không còn thấy IndexedDB cũ; xuất JSON để có bản sao riêng. Chưa có đồng bộ đám mây của hãng, backend/tài khoản mới hay chuyển ngân hàng cấu hình trên phần cứng.

Hồ sơ chứa Fn vẫn được đưa đầy đủ vào bản nháp theo các quy tắc trường cục bộ. Nếu Fn khác bản đọc hiện tại, toàn bộ Áp dụng bị chặn ở bước kiểm tra lệnh; không tự bỏ qua Fn hoặc gửi trước các nhóm khác. Kiểm tra bị chặn trước khi gửi giữ nguyên baseline mới, bản nháp và quyền hoàn tác. Metadata trong hồ sơ hoặc fixture không tạo xác thực firmware hay quyền ghi trực tiếp.

Thư viện/chia sẻ đám mây, đồng bộ âm nhạc, công cụ phụ trợ và cập nhật firmware phụ thuộc dịch vụ hãng: [mở driver LEOBOG](https://leobog.driveall.cn/), chọn đúng model và làm theo hướng dẫn của hãng. Liên kết chỉ mở công cụ ngoài; không báo đã đồng bộ, hiệu chuẩn, reset hay flash trong ứng dụng.

## Đã đo được gì

Ngày 22/10/2026, công cụ USB gốc đọc đủ 9 nhóm (4688 byte) trên A80RT U 0C45:80A1, FF68/61, report0/64, firmware bytes [55,1] = 1.37. Phép thử được cho phép thay RGB lưu của W (slot34, offsets137–139), đọc lại khớp, rồi khôi phục; cả 9 nhóm cuối khớp dữ liệu ban đầu.

Đã đo 22 ACK ghi màu (0x24) và gói điều khiển sau ghi (0). Header phản hồi gồm 55/command/count/offset/00/final/00, report64, count56 và final8 cho màu; control0 count56/final1. Không giả định payload ACK lặp payload đọc. Kiểm thử có dùng bản sao header đã loại dữ liệu riêng; phần đệm trong thiết bị giả là dữ liệu tổng hợp, không phải capture phần cứng.

Các lệnh cấu hình 0x21–0x28 dùng cùng tuyến sendReportSuper/buildPkt_final/getStoreData trong mã nguồn hãng. Bản này cho phép các lệnh đã ánh xạ **trừ Fn 0x26/38** trên đúng giao diện và firmware có dây nêu trên, áp dụng chính sách header nghiêm ngặt và đọc lại các trường đã đổi. Giữ nguyên không retry ghi, kiểm tra nguồn phiên đọc mới, interface và write epoch. Không mở opcode tùy ý hay lệnh bảo trì compact.

Ngày 23/10/2026, phép thử trên chính trang riêng tư đã triển khai trong trình duyệt đã đạt: đọc 9/9 nhóm trên A80RT U có dây firmware 1.37, đổi riêng RGB lưu của W từ #000000 sang #1b80ff, **Áp dụng** báo đọc lại khớp rồi khôi phục #000000 bằng một lần Áp dụng được xác minh nữa. Chế độ đèn toàn bàn phím giữ nguyên 11. Bằng chứng này xác nhận luồng trình duyệt cho màu W; không mở rộng thành kiểm thử các nhóm khác, màu đèn nhìn thấy hoặc lưu sau mất điện. Kiểm tra mô phỏng không thay thế bằng chứng USB.

Ngày 24/10/2026, controller đo thêm trên cùng U có dây: ngưỡng nhấn RT của W 0→0,01→0 mm; vùng chết phía trên toàn bàn phím 0,30→0,31→0,30 mm; base W [0,0,0,0]→[2,0,26,0]→[0,0,0,0]. Mỗi phép có hai lần Áp dụng và đọc lại ngữ nghĩa khớp, gồm lần khôi phục. Đây là xác nhận cấu hình đọc lại, chưa đo cảm giác RT, ký tự phát ra hoặc lưu sau mất điện.

Ngày 25/10/2026, công cụ USB gốc dùng codec production `9697747` (0.3.1) đạt **10/10 phép ghi/đọc lại và khôi phục**, tổng 6036 khung: macro chưa gán; gán macro; TGL; MT; RS; SOCD; DKS; polling; độ sáng; điểm nhận. Mỗi phép kết thúc với cả 9 nhóm khớp từng byte bản gốc, không có thay đổi ngoài phạm vi. Macro A nhấn/nhả có delay 0/20 ms; các gán dùng Print slot99 và RS/SOCD thêm Insert slot103; DKS dùng mẫu trống1 với mốc [16,30,30,16]. Polling mã6→3→6 (8k→1k→8k), sáng5→4→5, điểm nhận Print raw0→120→0. ACK0/33/34/35/37/39/40 được đo, gồm settings32, lighting16 và đầu/cuối nhóm dài; không giả định ACK lặp payload. [Fixture tóm tắt đã loại dữ liệu riêng](tests/fixtures/a80rt-wired-feature-qualification.json) giữ sourceCommit lịch sử `9697747`, không chứa raw capture hoặc macro cá nhân.

Fn W/U vẫn không đổi được qua app 0.3.0/0.3.1; thử USB gốc không có control0 cũng thất bại. Driver hãng đổi UI Fn+U từ Print sang U, nhưng đọc USB mới vẫn là Prt và người dùng bấm Fn+U vẫn bật PrintScreen. Đã trả UI hãng về Print, đóng tab hãng và đọc cuối 9 nhóm khớp bản gốc. Vì vậy 0.3.2 chặn ghi Fn trước TX trên đúng A80RT U có dây firmware1.37; codec đủ4byte và chỉnh Fn cục bộ vẫn giữ ([ghi chú](docs/binding-source-evidence.md)). Chưa xác định nguyên nhân riêng firmware hay driver, không suy rộng sang mọi model/phiên bản.

Ma trận 10 phép mới là kiểm chứng cấu hình bằng công cụ USB gốc, **chưa thử Apply qua UI** cho các phép đó. Bằng chứng hosted browser màu W và RTpress/topDZ/base W trước đó giữ phạm vi riêng. Chưa đo key output/gameplay của các chức năng mới (ngoại trừ phép Fn+U âm tính do người dùng bấm), timing, màu đèn nhìn thấy, giữ sau mất điện, Apply toàn profile, bảo trì, đầu thu hoặc model/firmware khác.

## Chạy tại máy và kiểm thử

Không cần cài thư viện. Phục vụ thư mục `dist` qua localhost, ví dụ:

```text
python -m http.server 8787 --bind 127.0.0.1 --directory dist
```

Mở localhost bằng Chrome/Edge, không mở qua file://. Chạy kiểm thử giao thức, codec, phiên giao dịch và giao diện:

```text
npm test
```

HTML chứa một import map cho **toàn bộ 13** module JavaScript, dùng chung token phiên bản `0.3.5`; entry script và CSS dùng cùng token. Source imports giữ đường dẫn không query để browser có một registry/class và Node giữ cùng module identity. Mỗi lần phát hành thay module phải cập nhật phiên bản package, import map, entry/CSS và metadata cùng nhau; kiểm thử release graph kiểm tra đủ đường dẫn và các chu trình. Không dựa riêng vào `_headers` chưa xác minh trên Sites. Controller kiểm tra cache/CSP và triển khai lên Site hiện có.

## Giao thức và giới hạn

Nguồn: mã trình duyệt [driver LEOBOG](https://leobog.driveall.cn/), bundle `static/js/app.3086f769.js`, quan sát 22/10/2026; bản triển khai riêng từ các quan sát này. `dist/device/protocol-facts.json` ghi ánh xạ chi tiết và phân biệt bằng chứng nguồn với phép đo.

- VID0C45, PID80A1 A80RT U có dây, PID80A2 A80RT, PIDFEFC A80RT U Dongle; tên model phải khớp, không suy từ PID dùng chung.
- Đọc: device0x10/32, settings0x11/32, keymap0x12/512, lighting0x13/16, colors0x14/512, macro0x15/1024, Fn0x16/512, RT0x17/1024, DKS0x18/1024. Dung lượng macro vật lý chưa được đo; 1024 là vùng đọc theo nguồn.
- Request AA/command/count/offsetLE/00/final/00, payload từ byte8. Đọc có thể thử lại một lần; ghi/control không thử lại. Phản hồi khác command/offset bị bỏ qua; phản hồi ghi trùng command/offset nhưng sai count/flags/report length gây lỗi đóng.
- Chỉ một giao dịch giữ transport tại một thời điểm. Snapshot thực có provenance không thể phục hồi từ JSON; session và write epoch ngăn dùng bản đọc cũ sau ghi/kết nối lại. Firmware được xác thực qua phản hồi đọc đầy đủ trong phiên hiện tại; mẫu/import không tạo được attestation.
- Codec giữ byte chưa giải mã, từ chối trường và liên kết không hợp lệ. RT raw dương/100 là mm; điểm nhận raw0 được giữ nguyên, chưa xác định ý nghĩa vật lý. Các slot vật lý không liên tục, W34, Backspace92, PgDn108.
- “Đã áp dụng” chỉ xác nhận các trường đã sửa khớp đọc lại. Control0 là bước sau ghi theo nguồn, chưa phải bằng chứng lưu vĩnh viễn.

# A80RT Configurator — 0.3.0-preview

Ứng dụng WebHID cục bộ để đọc đủ 9 nhóm cấu hình LEOBOG A80RT / A80RT U, chỉnh bản nháp RT, gán phím, Fn, đèn, màu từng phím, macro, phím nâng cao và thiết lập chung. Dữ liệu thiết bị được xử lý trong trình duyệt. Đây là bản xem trước sử dụng được cho cấu hình có dây được hỗ trợ; hồ sơ cấu hình (profiles) và kiểm tra toàn bộ phạm vi vẫn đang thực hiện.

## Sử dụng

1. Mở trang trực tiếp trong Chrome hoặc Edge trên máy tính. Nếu khung xem không cho phép USB, mở URL của trang trong tab trình duyệt riêng. Đóng tab driver hãng.
2. Chọn **Kết nối bàn phím**, rồi **Đọc cấu hình**. Chỉ sau khi đọc đủ 9 nhóm mới chỉnh được bản nháp. Không thay dữ liệu thiếu bằng cấu hình mặc định.
3. Chọn phím và chỉnh các mục cần thiết. Mọi thay đổi chỉ ở bản nháp; thanh trượt không tự gửi USB.
4. Với **A80RT U có dây, firmware 1.37**, giao diện input/output report ID0, 64 byte, usage FF68/61, bấm **Áp dụng** để gửi. Ứng dụng chỉ báo đã áp dụng khi đọc lại khớp các trường đã sửa. Lỗi hoặc ngắt kết nối giữ lại bản nháp; nếu đã gửi một phần, đọc lại cấu hình trước khi thử tiếp.
5. Dữ liệu mẫu và JSON mở lại chỉ dùng cho bản nháp cục bộ. Kể cả JSON có nhãn nguồn thiết bị và firmware phù hợp cũng không cấp quyền ghi. Sau khi kết nối lại cần đọc mới. A80RT, đầu thu 2.4 GHz, firmware/giao diện khác vẫn chưa mở ghi.
6. Xuất JSON để lưu bản đang xem hoặc bản nháp. Tệp có thể chứa cấu hình cá nhân và macro; tự chọn nơi lưu/chia sẻ. Nhật ký giữ tối đa 500 gói cấu hình, không ghi nội dung gõ phím thông thường.

Các mục hiệu chuẩn và khôi phục vẫn bị khóa do chưa đo được ACK bảo trì. Firmware chỉ mở web hãng, không flash trong ứng dụng; chọn đúng model khi dùng công cụ ngoài.

## Đã đo được gì

Ngày 22/10/2026, công cụ USB gốc đọc đủ 9 nhóm (4688 byte) trên A80RT U 0C45:80A1, FF68/61, report0/64, firmware bytes [55,1] = 1.37. Phép thử được cho phép thay RGB lưu của W (slot34, offsets137–139), đọc lại khớp, rồi khôi phục; cả 9 nhóm cuối khớp dữ liệu ban đầu.

Đã đo 22 ACK ghi màu (0x24) và gói điều khiển sau ghi (0). Header phản hồi gồm 55/command/count/offset/00/final/00, report64, count56 và final8 cho màu; control0 count56/final1. Không giả định payload ACK lặp payload đọc. Kiểm thử có dùng bản sao header đã loại dữ liệu riêng; phần đệm trong thiết bị giả là dữ liệu tổng hợp, không phải capture phần cứng.

Các lệnh cấu hình 0x21–0x28 dùng cùng tuyến sendReportSuper/buildPkt_final/getStoreData trong mã nguồn hãng. Bản này cho phép các lệnh đã ánh xạ đó trên đúng giao diện và firmware có dây nêu trên, áp dụng chính sách header nghiêm ngặt và đọc lại các trường đã đổi. **Ngoài màu/control, các lệnh chưa được thử riêng trên phần cứng**; các gói ngắn đầu/cuối của settings32 và lighting16 cũng chưa đo riêng. Không mở opcode tùy ý hay lệnh bảo trì compact.

Phép đo xác nhận RGB được lưu và đọc lại trong cùng kết nối; chưa xác nhận màu đèn nhìn thấy, giữ cấu hình sau mất điện hoặc toàn bộ luồng ghi của ứng dụng trình duyệt. Kiểm tra với thiết bị mô phỏng không thay thế các phép thử này.

## Chạy tại máy và kiểm thử

Không cần cài thư viện. Phục vụ thư mục `dist` qua localhost, ví dụ:

```text
python -m http.server 8787 --bind 127.0.0.1 --directory dist
```

Mở localhost bằng Chrome/Edge, không mở qua file://. Chạy kiểm thử giao thức, codec, phiên giao dịch và giao diện:

```text
npm test
```

HTML chứa một import map cho **toàn bộ** module JavaScript, dùng chung token phiên bản `0.3.0-preview`; entry script và CSS dùng cùng token. Source imports giữ đường dẫn không query để browser có một registry/class và Node giữ cùng module identity. Mỗi lần phát hành thay module phải cập nhật phiên bản package, import map, entry/CSS và metadata cùng nhau; kiểm thử release graph kiểm tra đủ đường dẫn và các chu trình. Không dựa riêng vào `_headers` chưa xác minh trên Sites. Controller kiểm tra cache/CSP và triển khai lên Site hiện có.

## Giao thức và giới hạn

Nguồn: mã trình duyệt [driver LEOBOG](https://leobog.driveall.cn/), bundle `static/js/app.3086f769.js`, quan sát 22/10/2026; bản triển khai riêng từ các quan sát này. `dist/device/protocol-facts.json` ghi ánh xạ chi tiết và phân biệt bằng chứng nguồn với phép đo.

- VID0C45, PID80A1 A80RT U có dây, PID80A2 A80RT, PIDFEFC A80RT U Dongle; tên model phải khớp, không suy từ PID dùng chung.
- Đọc: device0x10/32, settings0x11/32, keymap0x12/512, lighting0x13/16, colors0x14/512, macro0x15/1024, Fn0x16/512, RT0x17/1024, DKS0x18/1024. Dung lượng macro vật lý chưa được đo; 1024 là vùng đọc theo nguồn.
- Request AA/command/count/offsetLE/00/final/00, payload từ byte8. Đọc có thể thử lại một lần; ghi/control không thử lại. Phản hồi khác command/offset bị bỏ qua; phản hồi ghi trùng command/offset nhưng sai count/flags/report length gây lỗi đóng.
- Chỉ một giao dịch giữ transport tại một thời điểm. Snapshot thực có provenance không thể phục hồi từ JSON; session và write epoch ngăn dùng bản đọc cũ sau ghi/kết nối lại. Firmware được xác thực qua phản hồi đọc đầy đủ trong phiên hiện tại; mẫu/import không tạo được attestation.
- Codec giữ byte chưa giải mã, từ chối trường và liên kết không hợp lệ. RT raw/100 là mm; giá trị raw0 giữ nguyên. Các slot vật lý không liên tục, W34, Backspace92, PgDn108.
- “Đã áp dụng” chỉ xác nhận các trường đã sửa khớp đọc lại. Control0 là bước sau ghi theo nguồn, chưa phải bằng chứng lưu vĩnh viễn.

# A80RT Reader — bản thử 0.1

Ứng dụng WebHID đọc cấu hình LEOBOG A80RT / A80RT U, có sơ đồ 82 phím, dữ liệu mẫu và xuất / mở JSON. Các thao tác USB chạy trong trình duyệt. Không có máy chủ thu thập dữ liệu thiết bị.

## Sử dụng

1. Mở trang trực tiếp trong Chrome hoặc Edge trên máy tính. Nếu khung xem không cho phép USB, mở URL của trang trong tab trình duyệt riêng.
2. Cắm bàn phím bằng cáp USB và đóng tab driver hãng.
3. Chọn **Kết nối bàn phím**, chọn thiết bị A80RT trong hộp thoại của trình duyệt.
4. Chọn **Đọc cấu hình**. Chọn phím để xem điểm nhận và dữ liệu gốc.
5. Xuất JSON nếu cần đối chiếu. Tệp gồm mô tả giao diện, các nhóm cấu hình đã nhận đủ và tối đa 500 gói tin gần nhất. Không ghi lại nội dung gõ phím thông thường.

**Chưa được xác nhận trên bàn phím vật lý.** Bộ kiểm thử dùng thiết bị mô phỏng để kiểm tra đóng gói, ghép dữ liệu, từ chối phản hồi thiếu, dừng đọc và thời gian chờ. Dữ liệu mẫu được đánh dấu riêng. Các nhánh phần cứng / firmware khác có thể chưa tương thích.

## Chạy tại máy

Không cần cài thư viện. Trong thư mục dự án:

```text
python -m http.server 8787 --bind 127.0.0.1 --directory dist
```

Mở `http://127.0.0.1:8787` bằng Chrome / Edge. Không mở `index.html` qua `file://`, vì trang dùng JavaScript modules.

Kiểm tra giao thức với Node.js:

```text
npm test
```

## Phạm vi giao thức

Tham chiếu: mã phía trình duyệt của https://leobog.driveall.cn/, quan sát ngày 22/10/2026. Tệp bundle tham chiếu: `static/js/app.3086f769.js` và `static/js/chunk-keyboard.c8da5c12.js`. Đây là bản triển khai nhỏ viết riêng từ các quan sát giao thức.

- VID `0x0C45`, PID `0x80A2` (A80RT), `0x80A1` (A80RT U); kiểm tra thêm tên thiết bị vì ID có thể dùng chung với mẫu khác.
- Tìm giao diện vendor usage `0xFF68`, `0xFF80`, `0xFF60`, ưu tiên `0xFF68`; chỉ nhận output report ID 0 có kích thước 32 hoặc 64 byte.
- Request: byte 0 `0xAA`, byte 1 mã lệnh, byte 2 độ dài đoạn, byte 3–4 offset little endian, byte 6 cờ đoạn cuối, payload từ byte 8. Request đọc dùng payload toàn 0.
- Response dự kiến: byte 0 `0x55`, cùng mã lệnh và offset, độ dài dữ liệu trong byte 2. Phản hồi không khớp bị bỏ qua; phản hồi thiếu dữ liệu báo lỗi.
- Lệnh cho phép: `0x10` thông tin (32 byte), `0x11` thiết lập (32), `0x12` keymap (512), `0x13` đèn (16), `0x16` Fn (512), `0x17` RT (1024). Không triển khai lệnh ghi, lưu, reset, hiệu chuẩn hay cập nhật firmware.
- RT: 8 byte / vị trí; byte 0 ID switch, byte 1 cờ chế độ, byte 2–3 điểm nhận little endian. Điểm nhận hiển thị theo raw / 100 mm; raw 0 được giữ là chưa xác định, không tự thay bằng mặc định.
- Ngưỡng nhấn / nhả byte 4–7 giữ nguyên đơn vị raw. Mã gán phím và Fn hiển thị nguyên 4 byte; chưa suy diễn macro hoặc phím đặc biệt.
- Các slot vật lý không liên tục; ví dụ W ở slot 34, Backspace 92, PgDn 108.

Nếu kết nối được nhưng không đọc được, xuất các nhóm đã nhận và nhật ký để đối chiếu giao thức trên thiết bị thật trước khi bổ sung chức năng ghi.

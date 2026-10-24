# Mã hóa thay gán phím và phiên ghi chưa xác nhận — 0.3.1

Đối chiếu bundle hãng `static/js/app.3086f769.js`, SHA-256 `924907c838ff49c6d5a8699b903ed7bb473c086e468076904516fbd0ca3e9419`, ngày 24/10/2026. Vị trí là Unicode codepoint bắt đầu 0, khoảng [đầu, cuối). Nguồn chính thức: [driver LEOBOG](https://leobog.driveall.cn/).

- 3225655–3225917: `getUpdateKeyData` khởi tạo [2,0,0,0], đặt type/payload cho phím, modifier, chuột, media hoặc đủ mã chức năng 24 bit.
- 3227116–3227234 và 3227870–3227961: tuyến ordinary Fn gọi `getBuildFn`; hàm này chép cả 4 byte vào `allFnPack[4*slot+t]`.
- 21100–21168: W là slot34, WIN, không có `fnDisabled`. 1988463–1988647: khóa chọn dựa trên `fnDisabled`; không có bằng chứng khóa W.

Vì vậy thay WIN [13,0,0,8] bằng keyboard W phải tạo [2,0,26,0]. Byte cuối 8 là payload kiểu cũ; chính sách cũ giữ nó như byte opaque đã sai đối với bản ghi được thay rõ ràng. Empty, keyboard/modifier, mouse và media ghi đủ 4 byte với byte cuối 0; function đã ghi đủ 4 byte. Chỉ bản ghi được thay được chuẩn hóa. Mọi bản ghi không sửa, vùng dành riêng và mask trường khác giữ nguyên.

Phép Fn W trên 0.3.0 bị lỗi đọc lại; đọc USB mới độc lập xác nhận WIN gốc vẫn còn. Chênh lệch mã hóa không chứng minh nguyên nhân phần cứng: cần controller thử bản 0.3.1. Hồi quy tổng hợp kiểm cả payload gửi, đọc lại semantic và khôi phục WIN qua chính sách wired thật; đó không phải capture hay bằng chứng Fn vật lý.

Sau Apply chưa xác nhận, baseline cũ không đại diện chắc chắn trạng thái thiết bị. Session bị invalidate, giữ draft và lỗi gốc; host khóa sửa/Apply/Hoàn tác, hướng dẫn đọc mới đủ 9 nhóm, vẫn cho xuất bản nháp. Không tự retry/restore. Đọc mới thành công tạo phiên mới; write epoch/provenance tiếp tục chặn baseline cũ. Lỗi preflight chưa gửi byte không bắt buộc invalidate.

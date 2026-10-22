# A80RT: thiết kế nâng từ Reader thành driver cấu hình

Trạng thái: người dùng đã duyệt ngày 22/10/2026 bằng phản hồi “k”; chưa triển khai phần ghi.

## Mục tiêu và yêu cầu đã có

Người dùng muốn thay web driver gốc khó dùng bằng một ứng dụng cấu hình đầy đủ cho bàn phím đang sở hữu. Người dùng đã chọn “Làm đầy đủ như web gốc”, không chỉ ưu tiên RT/remap/RGB. Tiếp tục trên web app đã triển khai tại https://a80rt-reader-lab-7c42.civilmap34.chatgpt.site/; giữ quyền truy cập riêng tư hiện có.

Thiết bị thực tế: **A80RT U Dongle**, VID `0x0C45`, PID `0xFEFC`, kết nối 2.4 GHz. Bản có dây A80RT / A80RT U vẫn là thiết bị đích. Phạm vi tính năng phải dựa vào khả năng của đúng mẫu và phương thức kết nối; không lấy các màn hình dành cho bàn phím khác trong bundle của hãng làm tính năng của A80RT.

## Hiện trạng đã kiểm tra

- Reader 0.2 có kết nối WebHID, đọc sáu nhóm dữ liệu, sơ đồ 82 phím, xem byte gốc và xuất/mở JSON. Mã hiện tại chủ động chỉ cho phép các lệnh đọc. Chưa có bộ chỉnh, nút áp dụng, ghi cấu hình, macro editor hoặc các màn hình nâng cao.
- Ngày 22/10/2026, giao diện của người dùng đã mở được đầu thu thật: usage page `0xFF80`, usage `1`, input/output report ID `0`, mỗi report `32` byte, không có feature report.
- Thử đọc lần đầu: gửi `AA 10 18 00 00 00 00 00 ...` qua report 0; hết thời gian chờ ở offset 0, chưa ghi nhận gói RX. **Kết nối thành công chưa chứng minh đường đọc/ghi đã hoạt động.** Chưa xác định nguyên nhân: bàn phím ngủ, một phiên driver khác, thời điểm truyền, hoặc khác biệt giao thức. Không dùng giả định này để thêm lệnh khởi tạo/ghi ngẫu nhiên.
- Bundle tham chiếu đã đọc: `https://leobog.driveall.cn/static/js/app.3086f769.js`, cùng bundle layout `chunk-keyboard.c8da5c12.js`. Định nghĩa A80RT U Dongle trong bundle xác nhận cùng layout và nhóm tính năng RT/nâng cao. Mã hãng phân biệt các khả năng như polling rate giữa cáp và đầu thu.

## Approaches

**Đề xuất của người triển khai: mở rộng web app và viết lại phần giao tiếp theo giao thức quan sát được.** Giữ JavaScript modules buildless và WebHID, không đổi nền tảng hay thêm máy chủ thu thập cấu hình. Cách này tái sử dụng kết nối và sơ đồ đã có, cho phép thay trải nghiệm cấu hình và chạy trực tiếp trong Chrome/Edge.

Hai hướng đã cân nhắc nhưng không đề xuất:

1. Chỉ tạo vỏ giao diện cho web driver hãng: ít việc giao thức hơn nhưng vẫn phụ thuộc giao diện và hành vi cũ mà người dùng muốn thay.
2. Đổi sang app desktop: có thể dùng HID native nhưng cần đóng gói/cài đặt và xử lý đa nền tảng; chưa có yêu cầu sử dụng ngoài Chrome/Edge và chưa có bằng chứng phải đổi nền tảng để giải quyết vấn đề hiện tại.

Lựa chọn nền tảng này do người triển khai đề xuất trong thiết kế đã được duyệt.

## Các phần phải có

| Màn hình | Hành vi cần đạt |
|---|---|
| Kết nối và tổng quan | Nhận đúng cáp/đầu thu; trạng thái mở giao diện, nhận dữ liệu và đồng bộ được phân biệt. Đọc dữ liệu thực trước khi bật chỉnh sửa thiết bị. Hiển thị phiên bản firmware và pin nếu dữ liệu thực có trường tương ứng. |
| Remap và Fn | Chọn một hoặc nhiều phím; gán phím thường, modifier, phím media, chức năng đặc biệt, macro và chức năng nâng cao theo bảng mã A80RT. Chỉnh độc lập lớp mặc định/Fn và giữ phần Fn mà firmware khóa. |
| RT và hành trình | Chỉnh điểm nhận, ngưỡng nhấn/nhả, các chế độ RT, loại switch hỗ trợ và dead zone; áp dụng theo phím hoặc nhóm. Các tên, cờ và đơn vị phải đối chiếu mã hãng và dữ liệu thật. |
| Phím nâng cao | RS/Rappy Snappy, SOCD, DKS, MT, TGL; có mô tả ngắn, bộ chọn phím liên quan, hành trình/thời gian khi cần và hiển thị ràng buộc khi các chức năng dùng chung một phím. |
| Macro | Tạo/sửa/xóa, chuỗi nhấn/nhả, độ trễ, chế độ lặp và gán macro cho phím hoặc lớp Fn. Ghi macro chỉ hoạt động trong phiên người dùng chủ động bật bộ ghi. Kiểm tra dung lượng và con trỏ trước khi gửi. |
| RGB | Các hiệu ứng thực sự được A80RT hỗ trợ, màu, độ sáng, tốc độ, hướng và RGB từng phím/vùng. Các hiệu ứng cần ứng dụng phụ của hãng phải nói rõ phụ thuộc đó; không giả vờ hoạt động thuần trình duyệt. |
| Profile | Profile lưu cục bộ theo đúng mẫu bàn phím; xuất/nhập và chuyển profile bằng cách áp dụng cấu hình tương ứng. Không tự quảng cáo nhiều bank onboard nếu firmware không có. Thư viện/chia sẻ đám mây riêng của hãng không được giả lập bằng API không được cấp quyền. Có thể mở chức năng hãng khi không có API được hỗ trợ. |
| Thiết lập | Những tùy chọn đúng mẫu hỗ trợ: hệ điều hành, ngủ/đánh thức, ổn định, hiệu chuẩn tự động, polling khi có và các tùy chọn phím của hãng. Không hiện nút chỉnh polling cho đường truyền không hỗ trợ. |
| Hiệu chuẩn, khôi phục và firmware | Cung cấp hướng dẫn và trạng thái thật cho hiệu chuẩn/reset. Hiển thị firmware hiện tại và lối mở công cụ/bản cập nhật chính thức. Chỉ triển khai flash trực tiếp sau khi luồng và xác minh ảnh firmware đúng mẫu được kiểm tra; không coi thao tác mở công cụ hãng là “flash trong app”. |
| Chẩn đoán | Giữ xuất JSON, mô tả report và trace TX/RX; báo lỗi theo công đoạn và nhóm dữ liệu. Không trộn cấu hình mẫu vào cấu hình thiết bị thật. |

Phạm vi “đầy đủ” là toàn bộ chức năng cấu hình của **A80RT U** có thể đối chiếu và xác minh, cùng đường dẫn rõ ràng cho các khả năng phụ thuộc dịch vụ/công cụ độc quyền của hãng. Bất kỳ chức năng chưa xác minh phải có trạng thái công khai, không có nút trang trí được báo là hoàn tất.

## Luồng chỉnh và lưu

1. Kết nối và đọc đủ các nhóm cần dùng. Nếu nhận thiếu, cho xuất trace và sửa đường đọc; không tạo cấu hình mặc định thay thế rồi ghi lên bàn phím.
2. Tách bản gốc đã đọc khỏi bản nháp đang chỉnh. Mọi byte chưa giải mã được phải giữ nguyên. Bộ chỉnh sửa chỉ chạm vào trường đã xác minh và phím đã chọn.
3. Hiển thị số thay đổi và nút **Áp dụng**; cho hoàn tác về bản đã đọc trước khi áp dụng. Không tự ghi sau mỗi sự kiện slider.
4. Gửi từng nhóm đã đổi theo thứ tự đã xác minh, đợi phản hồi tương ứng trước gói tiếp theo. Thao tác chồng lấn bị chặn; ngắt kết nối hoặc thiếu ACK dừng chuỗi và không báo thành công.
5. Thực hiện bước lưu/commit đúng giao thức khi đã xác minh, rồi đọc lại nhóm vừa đổi để so sánh. Chỉ báo “Đã áp dụng” khi đọc lại khớp. Nếu chưa chứng minh tồn tại qua ngắt kết nối, không gọi là lưu vĩnh viễn.
6. Chuyển profile và import phải đi qua cùng luồng kiểm tra, không phát lệnh firmware trực tiếp từ JSON nhập vào.

## Tổ chức mã đề xuất

- Giữ app browser-local. Tách transport WebHID, codec cho từng nhóm, model bản gốc/bản nháp, và các màn hình UI; tránh một app.js lớn.
- Hàng đợi giao tiếp dùng chung cho read/write; ACK phải khớp lệnh, offset và kích thước theo từng loại phản hồi. Không giả định ACK ghi có cùng payload với phản hồi đọc.
- Bảng capability và giới hạn riêng cho A80RT có dây, A80RT U có dây và A80RT U Dongle. Dùng chung phần layout khi đúng mẫu; không tự nhận thiết bị chỉ dựa vào PID dùng chung.
- Quản lý kết nối, đang đọc, đang ghi, đã đọc lại và lỗi thành các trạng thái riêng. Mẫu minh họa có nhãn rõ, không mở thiết bị, không gửi gói.
- Không thêm tài khoản, telemetry hoặc tải cấu hình lên máy chủ. Giao diện hiện có được chỉnh thành công cụ cấu hình có tab; tiếp tục tiếng Việt.

## Bằng chứng giao thức và phần cần xác minh

Đã thấy trong mã hãng: đọc `0x10` thông tin, `0x11` settings, `0x12` keymap, `0x13` LED, `0x14` màu từng phím, `0x15` macro, `0x16` Fn, `0x17` RT, `0x18` DKS. Nhánh ghi tương ứng có `0x21` settings, `0x22` keymap, `0x23` LED, `0x24` màu, `0x25` macro, `0x26` Fn, `0x27` RT, `0x28` DKS. Mã hãng gọi thêm lệnh `0x00` sau một số thay đổi; phải xác minh ý nghĩa và ACK trước khi dùng. Đây là đầu mối từ mã, không phải xác nhận ghi thành công trên thiết bị thật.

Trước khi triển khai cần lập bảng byte cho key types, phím đặc biệt, mode flags RT, đơn vị press/release, cấu trúc macro/con trỏ, advanced key và các trường settings/LED. Lưu byte gốc và fixture độc lập để tránh ghi lại cả vùng bằng số 0. Kích thước macro và bảng pointer phải được xác định từ dữ liệu và mã tham chiếu thay vì mặc định mọi mẫu là 1024 byte.

## Tiêu chí hoàn tất

- Đọc được dữ liệu thật trên đầu thu của người dùng, với trace cho thấy RX và độ phủ nhóm đầy đủ.
- Mỗi màn hình có bộ chỉnh thật, validation theo giới hạn của mẫu và trạng thái đồng bộ rõ ràng.
- Kiểm thử codec phải chứng minh một thay đổi chỉ đổi các byte cần thiết và giữ nguyên mọi byte khác. Kiểm tra chuỗi gói nhiều phần, ACK sai/chậm, lỗi gửi, ngắt kết nối, thiếu dung lượng macro và JSON không hợp lệ.
- Với thay đổi thử nghiệm người dùng chọn: ghi, đọc lại khớp; nếu tuyên bố lưu vĩnh viễn thì còn khớp sau kết nối lại. Không tự đổi thông số chơi game của người dùng chỉ để tạo bằng chứng.
- Rà từng hàng trong bảng chức năng trên, ghi trạng thái đã kiểm tra thực tế / chỉ mô phỏng / phụ thuộc công cụ hãng. Không gọi “đầy đủ như web gốc” nếu còn thiếu chức năng không được công khai.
- Kiểm tra UI trên máy tính và màn hình hẹp, xuất ZIP mới, cập nhật cùng Site riêng tư và giữ nguyên quyền truy cập.

## Trình tự đề xuất

Giải quyết đọc thật và chốt capability → codec + ghi/ACK/đọc lại → RT, remap/Fn, RGB → macro và phím nâng cao → profile, thiết lập, hiệu chuẩn/reset/firmware → rà toàn bộ đối chiếu và triển khai.

Đây là thứ tự thực hiện của **một phạm vi đầy đủ**, không phải thu hẹp yêu cầu về chỉ ba chức năng đầu.

## Phần giao cho người triển khai

Người triển khai chọn cách chia module, tên file, bố trí tab và các công cụ kiểm thử trong stack hiện tại. Không tự thu hẹp danh sách chức năng hoặc quảng cáo khả năng firmware/đám mây chưa có. Các khác biệt giao thức cần đo thêm là công việc điều tra kỹ thuật, không yêu cầu người dùng đoán giá trị byte.

# Nguồn áp dụng RT và vùng chết

Đối chiếu ngày 23/10/2026, bổ sung xác minh A80RT thường ngày 25/10/2026 trên bundle hãng `static/js/app.3086f769.js`, SHA-256 `924907c838ff49c6d5a8699b903ed7bb473c086e468076904516fbd0ca3e9419`. Nguồn chính thức: [driver LEOBOG](https://leobog.driveall.cn/). Các vị trí dưới đây là chỉ số Unicode codepoint, bắt đầu 0, khoảng `[đầu, cuối)` sau giải mã UTF-8. Controller đã kiểm tra độc lập 31 đoạn và hash nguyên văn trong bản nghiên cứu; tài liệu này lưu các vị trí liên quan để đối chiếu phát hành. Đây là bằng chứng mã nguồn, không phải phép thử phần cứng.

| Vị trí app.js | Bằng chứng và cách áp dụng |
|---|---|
| 1626867–1627905; bản lặp fixture 1020378–1021416 | Catalog A80RT PID32930: `isAxial:true`, `isZone:true`, min0/max50, axial.value1..6, không có timeValue/isModel. Fixture công khai `model-wired` giữ bản lặp. |
| 1627905–1628943 | Catalog A80RT U PID32929: `isZone:true`, min0/max50, danh sách axial, không có isModel hoặc timeValue. |
| 1628944–1630043 | Catalog U Dongle PID65276: cùng vùng chết và axial, `timeValue:1`, không có isModel. |
| 2773350–2773880 | Tab vùng chết chỉ phụ thuộc `RtInfo.isZone`; trạng thái bật là trạng thái giao diện/profile, không chứng minh bit firmware riêng. |
| 2774090–2774710; 2774849–2775490 | Slider trên/dưới dùng min/max catalog và step1; nhãn hiển thị raw/100 mm. Phạm vi raw0..50 tương ứng0.00..0.50mm, bước0.01mm. |
| 3196329–3196500 | Đọc vùng chết từ settings[8]/[9]. |
| 3203541–3203880; 2790607–2790821; 3214020–3214300 | Handler chuyển nguyên raw vào settings[8]/[9]. Ứng dụng giữ snapshot hiện tại và byte khác, không sao chép cách hãng tạo vùng đệm zero. |
| 2791473–2791688 | Công tắc hãng đặt cả hai raw30 khi bật, raw0 khi tắt. Chỉ hai byte này không phân biệt trạng thái bật có hai giá trị0; ứng dụng cung cấp hai giá trị số và không bịa bit enable. |
| 1983660–1983860 | whole=bit0, bottom=bit1, isRtMode=bit2. Giữ mọi bit ngoài trường đang sửa. |
| 2772330–2773325 | whole hiển thị vô điều kiện trong bảng RT cho cả ba model; chỉ Rampage ngay sau đó phụ thuộc isModel, không có trong cả ba catalog. Không có control bottom trong render áp dụng 2764450–2776190. Vì vậy bottom/rtMode chỉ đọc, không cho sửa. |
| 2039112–2039321 | whole có tên Full Distance Fast Trigger: bật để RT duy trì hoạt động, tắt để RT có hiệu lực sau khi đạt điểm nhận. Đây là diễn giải nguồn, chưa đo riêng. |
| 2039322–2039542; 2049476–2049876 | Có tên Bottom Optimization/Rampage Mode và mô tả chung; tên dịch không tự chứng minh hỗ trợ trên model. |
| 2766840–2767460 | Bộ chọn switch phụ thuộc isAxial và **không có timeValue**: hiển thị A80RT thường và U có dây, ẩn dongle theo timeValue1. |
| 1626867–1630043 | `axial[].value`:1 Shape Meaning Switch;2 Magnetic Jade Pro;3 Magneto Shaft;4 White Jade Scroll;5 Dream Blue Axis;6 Ash wood shaft. Giữ tên bản dịch hãng dù tiếng Anh khác thường. `axial.id` và firmware `AxialModel` là danh tính khác. |

Hash đoạn catalog A80RT trong fixture `model-wired` (offset1020378, length1038) là `4517ae0d600563c211320db647e6926dd99cace218de5c9e80d444a59b561a7d`. Hash của hai catalog U nguyên văn lần lượt `8868251108dd6dad8d0cd5d7d70f77e8a034418b47832d113c2e491af5fa9f7a` và `c1b6a9c6c6c9aa7038004aacc2a5f137d4c50fd552dc9dabcade64e41b2a5351`. Hash slider trên/dưới lần lượt `511a111fe9eab871bf130d5cea00c5d4309793910e2238a2ec184b5d999fdcb6` và `3eccd4e6a41512035b4f69574145ca65ad942568b8a0b3d46649ff290be63612`. Hash mapping bit `f133e1174aed3d4ac468d5e315ca048043aa6bd101d2c9e5a42e5284a7face22`; hash gate whole/isModel `9f64fc7b3ba8b3590f69f1180dfb38820ab1b9d3ebfd8e9d6a639bd904abbd21`; hash gate switch `56fd4e18a5be1169507f181f78d73520c4c05568b306c684bcee328c15252176`.

Raw switch0 được giữ bằng0 dù nguồn dùng defaultValue1 khi hiển thị; ID chưa biết vẫn là ID chưa biết. Không dùng mã catalog19 để ghi switchID4, không đoán hành trình ID lạ. Thông báo nguồn yêu cầu hiệu chuẩn sau đổi switch không chứng minh đã hiệu chuẩn. Tải hồ sơ chỉ chuyển trường được capability cho phép, giữ bit/ID không hỗ trợ của phiên hiện tại; bản xem trước liệt kê các khác biệt bị bỏ qua.

Các gate trên cho phép chỉnh cục bộ whole, switch và settings[8]/[9] trên A80RT80A2 cùng giới hạn như U có dây; bottom/rtMode vẫn chỉ đọc. Đây không phải qualification phần cứng: chỉ đúng U80A1 firmware1.37 với giao diện đã đo được ghi. A80RT80A2 và dongle vẫn chưa được ghi. Không có phép thử USB mới từ sửa capability này.

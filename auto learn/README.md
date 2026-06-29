# EduBot Pro - Trợ Lý Tự Học E-Learning 🚀

**EduBot Pro** (Rikkei Edu Auto Learn Booster) là một Chrome Extension mạnh mẽ được thiết kế để tối ưu hóa và tự động hóa quá trình học tập trên nền tảng e-learning (như `rikkei.edu.vn`, `rikkeiedu.com`). Tiện ích giúp người học tiết kiệm thời gian qua các tính năng tự động tua video lý thuyết, tự động hoàn thành bài đọc, tự động chuyển bài và ghi nhận tiến trình trực quan.

---

## 🌟 Tính Năng Nổi Bật

- **⚡ Tự Động Tua & Phát Video**:
  - Tự động phát video ngay khi mở bài học.
  - Tự động tua nhanh video đến những giây cuối (hỗ trợ cả trình phát HTML5 gốc lẫn video nhúng như YouTube, Vimeo).
  - Tùy chỉnh tốc độ phát từ `1.0x` lên đến `8.0x`.
- **📝 Tự Động Hoàn Thành Bài Đọc & Tự Luận**:
  - Nhận diện các câu hỏi tự luận trên trang lý thuyết.
  - Tự động điền câu trả lời mẫu/nội dung vào các khung soạn thảo phổ biến như **CKEditor**, **Quill**, **TinyMCE** hoặc các thẻ `input`/`textarea` thông thường sau **3 giây** (giúp hoạt động giống hành vi người dùng thật và tránh spam).
  - Tự động xác nhận và bỏ qua các hộp thoại thông báo phiền toái (`window.confirm`).
- **⏭️ Chuyển Bài Tự Động**:
  - Tự động điều hướng sang bài học tiếp theo ngay khi bài học hiện tại hoàn thành.
- **📊 Bảng Điều Khiển Trực Quan (Dashboard)**:
  - Hiển thị phần trăm tiến trình hoàn thành bài học hiện tại bằng Progress Bar động.
  - Thống kê số lượng bài đã hoàn thành và ước tính thời gian tiết kiệm được.
  - Tích hợp terminal hiển thị nhật ký hoạt động (logger) theo thời gian thực để theo dõi hoạt động của bot.
- **🛡️ An Toàn & Đáng Tin Cậy**:
  - Cơ chế nhận diện tiêu điểm (focus) thông minh: Phân biệt việc phát video chủ động từ người dùng (được phép tua) hay hệ thống tự chạy.
  - Tích hợp công cụ ghi lại sự kiện (Event Recorder) để debug và mô phỏng hành vi.
  - Đi kèm một **Môi trường giả lập (Simulation Harness)** ngoại tuyến giúp nhà phát triển kiểm thử tính năng an toàn mà không ảnh hưởng tới tài khoản học thật.

---

## 📂 Cấu Trúc Thư Mục Dự Án

Dự án bao gồm các thành phần cốt lõi sau:

```text
├── manifest.json          # Tệp cấu hình Chrome Extension (Manifest V3)
├── background.js          # Service worker quản lý cấu hình và trạng thái lưu trữ (storage)
├── content.js             # Content script chính chạy trên các trang RikkeiEdu để tự động hóa
├── main_world.js          # Script can thiệp sâu vào DOM/JS context để bypass confirm/CKEditor
├── youtube_content.js     # Content script nhúng chạy riêng trong iframe YouTube
├── popup.html             # Giao diện bảng điều khiển Dashboard của Extension
├── popup.css              # Giao diện phong cách Glassmorphism hiện đại cho Dashboard
├── popup.js               # Logic điều khiển, đồng bộ cấu hình và hiển thị nhật ký từ Content Script
├── icon.png               # Ảnh biểu tượng của Extension
├── simulation.html        # Trang giả lập hệ thống RikkeiEdu ngoại tuyến để kiểm thử
├── simulation.js          # Logic mô phỏng các bài học video, bài đọc lý thuyết và quiz
└── simulation.css         # Giao diện trang giả lập
```

---

## 🛠️ Hướng Dẫn Cài Đặt (Installation Guide)

Để cài đặt và chạy thử nghiệm tiện ích dưới dạng Unpacked Extension trên trình duyệt Chromium (Google Chrome, Microsoft Edge, Brave, Cốc Cốc), bạn thực hiện theo các bước sau:

### Bước 1: Tải mã nguồn về máy
Hãy chắc chắn rằng toàn bộ mã nguồn của dự án đã được tải và nằm gọn trong thư mục `auto learn` trên máy tính của bạn.

### Bước-2: Truy cập trang quản lý Extension
- Mở trình duyệt Chrome hoặc Edge của bạn.
- Nhập đường dẫn sau vào thanh địa chỉ và nhấn **Enter**:
  - Chrome: `chrome://extensions/`
  - Edge: `edge://extensions/`

### Bước 3: Kích hoạt chế độ cho nhà phát triển (Developer Mode)
- Ở góc trên cùng bên phải của trang quản lý Extension, hãy gạt công tắc **Chế độ dành cho nhà phát triển (Developer mode)** sang trạng thái **BẬT (ON)**.

### Bước 4: Tải tiện ích lên trình duyệt
- Nhấp vào nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên cùng bên trái.
- Một hộp thoại chọn thư mục sẽ xuất hiện. Hãy điều hướng và chọn thư mục **`auto learn`** (thư mục chứa tệp `manifest.json`).
- Nhấp **Select Folder** (Chọn thư mục).
- Lúc này, **EduBot Pro - Trợ Lý Tự Học E-Learning** sẽ xuất hiện trong danh sách extension đang hoạt động.

### Bước 5: Ghim Extension lên thanh công cụ
- Click vào biểu tượng mảnh ghép hình **Extensions** (Tiện ích) trên thanh công cụ của trình duyệt.
- Tìm đến **EduBot Pro** và click vào biểu tượng **Ghim (Pin)** để tiện theo dõi Dashboard.

---

## 📖 Hướng Dẫn Sử Dụng (Usage Guide)

### 1. Sử dụng trên Trang học tập RikkeiEdu thật
1. Đăng nhập vào trang học tập của bạn (`rikkei.edu.vn` hoặc `rikkeiedu.com`).
2. Mở một khóa học và bấm vào bài học đầu tiên.
3. Click vào biểu tượng **EduBot Pro** trên thanh công cụ để mở Dashboard điều khiển:
   - **Tự động học**: Bật tùy chọn này để Bot tự động tua video đến cuối và tự điền câu trả lời cho bài đọc lý thuyết.
   - **Chuyển bài tự động**: Bật tùy chọn này để trang tự động chuyển sang bài tiếp theo khi bài hiện tại được tích xanh hoàn thành.
   - **Cấu hình tốc độ**: Bạn có thể tùy chỉnh tốc độ tua (giây) và tốc độ phát video (lên đến 8x).
4. Bạn cũng có thể kích hoạt các lệnh thủ công bằng cách nhấn các nút:
   - ⏳ *Tua video đến cuối*
   - 📖 *Chuyển sang bài đọc*
   - 📝 *Hoàn thành bài đọc*
5. Theo dõi tiến trình qua thanh tiến độ (Progress Bar) và kiểm tra các bước thực hiện của bot thông qua **Nhật ký hoạt động** ngay bên dưới.

### 2. Sử dụng trên Môi trường Giả lập (Kiểm thử an toàn)
Dự án đi kèm một trang giả lập để bạn có thể test mọi tính năng mà không cần tài khoản RikkeiEdu thật:
1. Mở trình duyệt Chrome.
2. Nhấn tổ hợp phím `Ctrl + O` (hoặc kéo thả) và mở tệp **`simulation.html`** có trong thư mục dự án.
3. Trang giả lập hiển thị giao diện khóa học ảo: **`[IT-215] Phát triển dịch vụ Web với FastAPI`**.
4. Click **Học ngay ↗** để vào giao diện học tập ảo.
5. Mở Dashboard **EduBot Pro** và xem cách Bot tự động chạy tương tác: tua video giả lập, tự động hoàn thành bài đọc sau 3 giây, và tự điều hướng qua 25 bài học của khóa học ảo này.

---

## 🚀 Hướng Dẫn Push Dự Án Lên GitHub

Để đẩy mã nguồn này lên kho lưu trữ GitHub của bạn, hãy thực hiện theo các lệnh Git dưới đây:

### Bước 1: Khởi tạo Git trong thư mục dự án
Mở terminal hoặc PowerShell tại thư mục `auto learn` và chạy:
```bash
# Di chuyển vào thư mục dự án
cd "c:\Users\Admin\Downloads\auto learn"

# Khởi tạo kho lưu trữ Git cục bộ
git init
```

### Bước 2: Thêm tệp bỏ qua `.gitignore` (Khuyên dùng)
Tạo một tệp tên `.gitignore` tại thư mục gốc để bỏ qua các tệp không cần thiết (như các thư mục nháp `scratch`, file rác hệ thống):
```bash
echo "scratch/" > .gitignore
echo "*.zip" >> .gitignore
echo "*.rar" >> .gitignore
```

### Bước 3: Thêm toàn bộ tệp và Commit lần đầu
```bash
# Thêm tất cả các tệp của extension vào hàng đợi Git
git add .

# Tạo commit đầu tiên
git commit -m "Initial commit: EduBot Pro Chrome Extension v3.4.0"
```

### Bước 4: Tạo Repository mới trên GitHub
1. Truy cập [github.com](https://github.com/) và đăng nhập tài khoản của bạn.
2. Nhấn nút **New** (hoặc dấu cộng ở góc trên bên phải -> **New repository**).
3. Đặt tên kho lưu trữ (ví dụ: `edubot-pro-lms`).
4. Để cấu hình mặc định (Public/Private tùy ý) và **KHÔNG** tích chọn các mục tạo sẵn README, .gitignore hoặc License.
5. Nhấn **Create repository**.

### Bước 5: Liên kết kho lưu trữ cục bộ với GitHub và Push
Thay thế liên kết GitHub bằng link repository thực tế bạn vừa tạo:
```bash
# Đổi tên nhánh mặc định thành main
git branch -M main

# Liên kết với kho lưu trữ trên GitHub (Thay link dưới bằng link của bạn)
git remote add origin https://github.com/USERNAME/REPOSITORY_NAME.git

# Đẩy mã nguồn lên GitHub
git push -u origin main
```

---

## 📝 Bản quyền và Tuyên bố miễn trừ trách nhiệm
Mã nguồn này phục vụ cho mục đích nghiên cứu học tập, phát triển Chrome Extension và thử nghiệm giả lập DOM. Người sử dụng tự chịu trách nhiệm nếu sử dụng công cụ này vi phạm các chính sách học tập của các bên liên quan.

Chúc bạn có trải nghiệm học tập và phát triển hiệu quả với **EduBot Pro**!

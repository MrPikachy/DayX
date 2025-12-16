document.addEventListener("DOMContentLoaded", () => {
    const uploadBtn = document.getElementById("btn-upload-avatar");
    const fileInput = document.getElementById("avatar-input");
    const avatarImage = document.getElementById("avatar-image");

    // Перевіряємо, чи існують елементи на сторінці
    if (uploadBtn && fileInput) {
        
        // 1. Клік по кнопці викликає клік по прихованому інпуту
        uploadBtn.addEventListener("click", () => {
            fileInput.click();
        });

        // 2. Коли файл обрано
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log("[JS] Починаємо завантаження:", file.name);
                
                const formData = new FormData();
                formData.append("avatar", file);

                // Відправка на сервер
                fetch("/api/user/avatar", {
                    method: "POST",
                    body: formData,
                })
                .then((r) => r.json())
                .then((data) => {
                    console.log("[JS] Відповідь сервера:", data);
                    
                    if (data.success) {
                        // Оновлюємо картинку відразу без перезавантаження сторінки
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            if(avatarImage) {
                                avatarImage.src = event.target.result;
                            }
                        };
                        reader.readAsDataURL(file);
                    } else {
                        alert("Помилка: " + (data.error || "Невідома помилка"));
                    }
                })
                .catch((err) => {
                    console.error("Помилка мережі:", err);
                    alert("Помилка завантаження. Перевірте консоль.");
                });
            }
        });
    } else {
        console.error("Елементи завантаження аватара не знайдені в HTML!");
    }
});

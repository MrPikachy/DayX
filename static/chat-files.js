document.addEventListener('DOMContentLoaded', function() {
    // Отримуємо ID команди з URL
    const teamId = window.location.pathname.split("/").pop(); 
    
    // Елементи чату та файлів
    const messageInput = document.getElementById("message-input");
    const sendBtn = document.getElementById("send-btn");
    const attachBtn = document.getElementById("attach-btn");
    const fileInput = document.getElementById("file-input");
    const filePreview = document.getElementById("file-preview");
    const filePreviewName = document.getElementById("file-preview-name");
    const removeFileBtn = document.getElementById("remove-file-btn");
    const messagesContainer = document.getElementById("messages-container");

    let selectedFile = null;

    // --- 1. Логіка скрепки ---
    if (attachBtn) {
        attachBtn.addEventListener("click", (e) => {
            e.preventDefault(); 
            fileInput.click();
        });
    }

    // Коли файл обрано
    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                selectedFile = file;

                // Перевіряємо, чи це картинка
                if (file.type.startsWith('image/')) {
                    // Створюємо прев'ю картинки
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        filePreview.innerHTML = `
                            <div class="file-preview-header" style="width:100%; display:flex; justify-content:space-between; margin-bottom:5px;">
                                <span>Обрано зображення:</span>
                                <button id="remove-file-btn-dynamic" style="background:none; border:none; color:#1f71e8; cursor:pointer; font-weight:bold;">✕</button>
                            </div>
                            <img src="${e.target.result}" style="max-height: 100px; border-radius: 4px; display: block;">
                            <div style="font-size:12px; color:#666; margin-top:4px;">${file.name}</div>
                        `;
                        filePreview.classList.remove("hidden");

                        // Відновлюємо слухач на кнопку видалення (бо ми перезаписали HTML)
                        document.getElementById("remove-file-btn-dynamic").addEventListener("click", clearFile);
                    };
                    reader.readAsDataURL(file);
                } else {
                    // Якщо звичайний файл
                    filePreview.innerHTML = `
                         <div class="file-preview-header">
                            <span>Обраний файл:</span>
                            <button id="remove-file-btn-dynamic" class="btn-remove-file">✕</button>
                        </div>
                        <div class="file-preview-name">📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)</div>
                    `;
                    filePreview.classList.remove("hidden");

                    document.getElementById("remove-file-btn-dynamic").addEventListener("click", clearFile);
                }
            }
        });
    }

    // Функція очистки (виніс окремо, щоб перевикористовувати)
    function clearFile() {
        selectedFile = null;
        fileInput.value = "";
        filePreview.classList.add("hidden");
        filePreview.innerHTML = ''; // Очищаємо контент
    }

    // Стара кнопка видалення (якщо вона є в HTML спочатку)
    if (removeFileBtn) {
        removeFileBtn.addEventListener("click", clearFile);
    }

    // --- 2. Відправка повідомлення ---
    async function sendMessage() {
        const message = messageInput.value.trim();

        if (!message && !selectedFile) return;

        const formData = new FormData();
        formData.append("message", message);
        if (selectedFile) {
            formData.append("file", selectedFile);
        }

        try {
            sendBtn.disabled = true;
            const response = await fetch(`/api/team/${teamId}/message/upload`, {
                method: "POST",
                body: formData,
            });

            if (response.ok) {
                messageInput.value = "";
                selectedFile = null;
                fileInput.value = "";
                filePreview.classList.add("hidden");
                window.location.reload();
            } else {
                const data = await response.json();
                alert(`Помилка: ${data.error || 'Не вдалося відправити'}`);
            }
        } catch (error) {
            console.error("Error sending message:", error);
            alert("Помилка з'єднання");
        } finally {
            sendBtn.disabled = false;
        }
    }

    if (sendBtn) {
        sendBtn.addEventListener("click", sendMessage);
    }

    if (messageInput) {
        messageInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                sendMessage();
            }
        });
    }

    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // --- 3. Логіка модальних вікон на сторінці чату ---
    
    // Відкриття
    document.getElementById("members-btn")?.addEventListener("click", () => document.getElementById("modal-members").classList.remove("hidden"));
    document.getElementById("rename-btn")?.addEventListener("click", () => document.getElementById("modal-rename").classList.remove("hidden"));
    document.getElementById("add-member-btn")?.addEventListener("click", () => {
        document.getElementById("modal-add-member").classList.remove("hidden");
        document.getElementById("add-member-email").focus();
    });

    // Setup modals using the global utility function
    if (typeof setupModal === 'function') {
        setupModal('modal-members');
        setupModal('modal-rename');
        setupModal('modal-add-member');
    }

    // Запрошення учасника
    document.getElementById("confirm-add-member")?.addEventListener("click", async () => {
        const email = document.getElementById("add-member-email").value;
        const errorDiv = document.getElementById("add-member-error");
        
        if(!email) {
             errorDiv.textContent = "Введіть email";
             errorDiv.style.display = "block";
             return;
        }
        
        try {
            const res = await fetch(`/api/team/${teamId}/add-member`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({email})
            });
            const data = await res.json();
            if(res.ok) { 
                alert("Запрошення надіслано!"); 
                location.reload(); 
            } else { 
                errorDiv.textContent = data.error;
                errorDiv.style.display = "block";
            }
        } catch(e) { console.error(e); }
    });

     // Зміна назви
     document.getElementById("save-rename")?.addEventListener("click", async () => {
        const name = document.getElementById("new-team-name").value;
        if(!name) return;
        try {
            const res = await fetch(`/api/team/${teamId}/rename`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name})
            });
            if(res.ok) location.reload();
        } catch(e) { console.error(e); }
    });
    
    // Вихід
    document.getElementById("leave-btn")?.addEventListener("click", async () => {
        if(confirm("Вийти з команди?")) {
            await fetch(`/api/team/${teamId}/leave`, {method:'POST'});
            window.location.href = '/teams';
        }
    });
    
    // Розпуск
    document.getElementById("disband-btn")?.addEventListener("click", async () => {
        if(confirm("Видалити команду? Це незворотно.")) {
            await fetch(`/api/team/${teamId}/disband`, {method:'POST'});
            window.location.href = '/teams';
        }
    });
    
    // Вигнати учасника
    document.querySelectorAll(".btn-remove-member").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            if(!confirm("Вигнати користувача?")) return;
            const uid = e.target.dataset.memberId;
            await fetch(`/api/team/${teamId}/remove-member/${uid}`, {method:'DELETE'});
            location.reload();
        });
    });
});
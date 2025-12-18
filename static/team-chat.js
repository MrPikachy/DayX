document.addEventListener('DOMContentLoaded', () => {
    // Ініціалізація іконок
    lucide.createIcons();

    const teamId = window.TEAM_ID;
    const messagesContainer = document.getElementById('messages-container');

    // --- АВТО-СКРОЛ ВНИЗ ---
    const scrollToBottom = () => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };
    scrollToBottom(); // Скролимо при завантаженні

    // ==========================================
    // 1. ЛОГІКА ПОВІДОМЛЕНЬ ТА ФАЙЛІВ
    // ==========================================
    const messageInput = document.getElementById('message-input');
    const fileInput = document.getElementById('file-input');
    const attachBtn = document.getElementById('attach-btn');
    const sendBtn = document.getElementById('send-btn');
    const uploadPreview = document.getElementById('upload-preview');
    const uploadFilename = document.getElementById('upload-filename');
    const clearUploadBtn = document.getElementById('clear-upload');

    // Клік на скріпку
    attachBtn.addEventListener('click', () => fileInput.click());

    // Вибір файлу
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            uploadFilename.textContent = fileInput.files[0].name;
            uploadPreview.classList.remove('hidden');
        }
    });

    // Очистити файл
    clearUploadBtn.addEventListener('click', () => {
        fileInput.value = '';
        uploadPreview.classList.add('hidden');
    });

    // Відправка повідомлення
    const sendMessage = async () => {
        const text = messageInput.value.trim();
        const file = fileInput.files[0];

        if (!text && !file) return;

        // Блокуємо кнопку
        sendBtn.disabled = true;

        const formData = new FormData();
        formData.append('message', text);
        if (file) {
            formData.append('file', file);
        }

        try {
            const res = await fetch(`/api/team/${teamId}/message/upload`, {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                // Очистка
                messageInput.value = '';
                fileInput.value = '';
                uploadPreview.classList.add('hidden');

                // Перезавантаження сторінки для відображення нового повідомлення
                // (У майбутньому можна зробити через WebSocket або AJAX додавання в DOM)
                window.location.reload();
            } else {
                alert('Помилка відправки');
            }
        } catch (err) {
            console.error(err);
            alert("Помилка з'єднання");
        } finally {
            sendBtn.disabled = false;
        }
    };

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // ==========================================
    // 2. МОДАЛЬНІ ВІКНА ТА АДМІНІСТРУВАННЯ
    // ==========================================

    // --- Загальна функція для модалок ---
    const toggleModal = (modalId, show = true) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            if (show) modal.classList.remove('hidden');
            else modal.classList.add('hidden');
        }
    };

    // Закриття по кліку на overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.add('hidden');
        });
    });

    // --- 2.1 СКЛАД КОМАНДИ ---
    const membersBtn = document.getElementById('members-btn');
    const closeMembersBtn = document.getElementById('close-members');

    if (membersBtn) membersBtn.addEventListener('click', () => toggleModal('modal-members', true));
    if (closeMembersBtn) closeMembersBtn.addEventListener('click', () => toggleModal('modal-members', false));

    // Видалення учасника (для адміна)
    document.querySelectorAll('.btn-remove-member').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Видалити цього учасника?')) return;
            const memberId = btn.dataset.memberId;
            try {
                const res = await fetch(`/api/team/${teamId}/remove-member/${memberId}`, { method: 'DELETE' });
                if (res.ok) window.location.reload();
                else alert('Помилка видалення');
            } catch (e) { console.error(e); }
        });
    });

    // --- 2.2 ЗМІНА НАЗВИ ---
    const renameBtn = document.getElementById('rename-btn');
    const cancelRename = document.getElementById('cancel-rename');
    const saveRename = document.getElementById('save-rename');

    if (renameBtn) renameBtn.addEventListener('click', () => toggleModal('modal-rename', true));
    if (cancelRename) cancelRename.addEventListener('click', () => toggleModal('modal-rename', false));

    if (saveRename) {
        saveRename.addEventListener('click', async () => {
            const newName = document.getElementById('new-team-name').value;
            if (!newName) return;
            try {
                const res = await fetch(`/api/team/${teamId}/rename`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ name: newName })
                });
                if (res.ok) window.location.reload();
            } catch (e) { console.error(e); }
        });
    }

    // --- 2.3 ЗАПРОШЕННЯ ---
    const addMemberBtn = document.getElementById('add-member-btn');
    const cancelAddMember = document.getElementById('cancel-add-member');
    const confirmAddMember = document.getElementById('confirm-add-member');
    const addMemberError = document.getElementById('add-member-error');

    if (addMemberBtn) addMemberBtn.addEventListener('click', () => {
        addMemberError.style.display = 'none';
        toggleModal('modal-add-member', true);
    });
    if (cancelAddMember) cancelAddMember.addEventListener('click', () => toggleModal('modal-add-member', false));

    if (confirmAddMember) {
        confirmAddMember.addEventListener('click', async () => {
            const email = document.getElementById('add-member-email').value;
            if (!email) return;

            try {
                const res = await fetch(`/api/team/${teamId}/add-member`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ email: email })
                });

                const data = await res.json();
                if (res.ok) {
                    alert('Запрошення надіслано!');
                    toggleModal('modal-add-member', false);
                } else {
                    addMemberError.textContent = data.error || 'Помилка';
                    addMemberError.style.display = 'block';
                }
            } catch (e) { console.error(e); }
        });
    }

    // --- 2.4 РОЗПУСК / ВИХІД ---
    const disbandBtn = document.getElementById('disband-btn');
    const leaveBtn = document.getElementById('leave-btn');

    if (disbandBtn) {
        disbandBtn.addEventListener('click', async () => {
            if (!confirm('Ви точно хочете розпустити команду? Всі дані будуть втрачені.')) return;
            try {
                const res = await fetch(`/api/team/${teamId}/disband`, { method: 'POST' });
                if (res.ok) window.location.href = '/teams';
            } catch (e) { console.error(e); }
        });
    }

    if (leaveBtn) {
        leaveBtn.addEventListener('click', async () => {
            if (!confirm('Ви точно хочете покинути команду?')) return;
            try {
                const res = await fetch(`/api/team/${teamId}/leave`, { method: 'POST' });
                if (res.ok) window.location.href = '/teams';
            } catch (e) { console.error(e); }
        });
    }
});
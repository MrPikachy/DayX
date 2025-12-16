document.addEventListener('DOMContentLoaded', () => {
    const createTaskBtn = document.getElementById('create-task-btn');
    const taskModal = document.getElementById('task-modal');
    const cancelTaskBtn = document.getElementById('cancel-task-btn');
    const taskForm = document.getElementById('task-form');
    const tabs = document.querySelectorAll('.tab-btn');
    const contextMenu = document.getElementById('task-context-menu');

    let currentEditingTaskId = null;
    let currentContextMenuTask = null;

    // --- TABS ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // --- MODAL ---
    const openModal = (task = null) => {
        taskForm.reset();
        currentEditingTaskId = null;
        document.getElementById('task-id').value = '';

        if (task) {
            currentEditingTaskId = task.id;
            document.getElementById('modal-title').textContent = 'Редагувати задачу';
            document.getElementById('task-id').value = task.id;
            document.getElementById('task-title-input').value = task.title;
            document.getElementById('task-description-input').value = task.description || '';
            // Форматуємо дату для datetime-local input (YYYY-MM-DDTHH:MM)
            // Тут ми залишаємо як є, бо редагування "сирого" часу іноді зручніше,
            // але візуально в картці він буде конвертований
            document.getElementById('task-deadline-input').value = task.deadline ? task.deadline.slice(0, 16) : '';
        } else {
            document.getElementById('modal-title').textContent = 'Створити задачу';
        }
        taskModal.classList.remove('hidden');
    };

    const closeModal = () => {
        taskModal.classList.add('hidden');
    };

    if (createTaskBtn) createTaskBtn.addEventListener('click', () => openModal());
    if (cancelTaskBtn) cancelTaskBtn.addEventListener('click', closeModal);

    if (taskModal) {
        taskModal.addEventListener('click', (e) => {
            if (e.target === taskModal) closeModal();
        });
    }

    // --- API & RENDERING ---
    const fetchAndRenderTasks = async () => {
        try {
            const response = await fetch('/api/tasks');
            if (!response.ok) throw new Error('Failed to fetch tasks');
            const tasks = await response.json();

            // Очищення списків
            document.querySelectorAll('.tasks-list').forEach(list => list.innerHTML = '');

            tasks.forEach(task => {
                // Визначаємо ID колонки: personal або team-ID
                const contextPrefix = task.team_id ? `team-${task.team_id}` : 'personal';
                const statusPrefix = task.is_completed ? 'completed' : 'active';
                const listId = `${statusPrefix}-${contextPrefix}`;

                const list = document.getElementById(listId);
                if (list) {
                    list.appendChild(createTaskElement(task));
                }
            });
        } catch (error) {
            console.error('Error fetching tasks:', error);
        }
    };

    const createTaskElement = (task) => {
        const card = document.createElement('div');
        card.className = `task-card animated ${task.is_completed ? 'completed' : ''}`;
        card.dataset.taskId = task.id;

        // --- ВИПРАВЛЕННЯ ЧАСУ ТУТ ---
        let deadlineStr = 'Без дедлайну';
        let isUrgent = false;

        if (task.deadline) {
            // Додаємо "Z", якщо його немає, щоб сказати браузеру: "Це UTC час, переведи його в мій часовий пояс"
            const utcDeadline = task.deadline.endsWith('Z') ? task.deadline : task.deadline + 'Z';
            const dateObj = new Date(utcDeadline);

            // Форматуємо вже локальний час
            deadlineStr = dateObj.toLocaleString('uk-UA', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });

            // Перевірка на терміновість теж має враховувати часові пояси
            isUrgent = !task.is_completed && dateObj < new Date();
        }
        // -----------------------------

        // --- НОВЕ: HTML структура з чекбоксом ---
        card.innerHTML = `
            <div class="task-checkbox ${task.is_completed ? 'checked' : ''}" title="Відмітити як виконане">
                <i data-lucide="check" style="width: 14px; height: 14px; stroke-width: 3;"></i>
            </div>

            <div class="task-content-wrapper">
                <div class="task-title">${task.title}</div>
                ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
                <div class="task-deadline ${isUrgent ? 'urgent' : ''}">
                    <i data-lucide="clock" style="width:12px; height:12px; display:inline-block; vertical-align: middle;"></i>
                    <span style="vertical-align: middle;">${deadlineStr}</span>
                </div>
            </div>
        `;

        // Ініціалізуємо іконку галочки
        lucide.createIcons({
            root: card,
            nameAttr: 'data-lucide',
            attrs: {class: "lucide"}
        });

        // Обробка кліку по чекбоксу
        const checkbox = card.querySelector('.task-checkbox');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();

            // Візуальний ефект відразу (оптимістичний UI)
            const isNowCompleted = !checkbox.classList.contains('checked');
            checkbox.classList.toggle('checked');

            if (isNowCompleted) {
                card.classList.add('completed');
            } else {
                card.classList.remove('completed');
            }

            // Відправка запиту на сервер
            toggleTaskComplete(task);
        });

        // Context Menu Event
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            currentContextMenuTask = task;
            contextMenu.style.top = `${e.clientY}px`;
            contextMenu.style.left = `${e.clientX}px`;
            contextMenu.classList.remove('hidden');

            const toggleBtn = contextMenu.querySelector('[data-action="toggle-complete"]');
            if(toggleBtn) {
                toggleBtn.textContent = task.is_completed ? "Відновити" : "Завершити";
            }
        });

        return card;
    };

    // --- CRUD ---
    if (taskForm) {
        taskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const activeTab = document.querySelector('.tab-btn.active');
            let teamId = null;

            // Визначаємо team_id з активної вкладки
            if (activeTab && activeTab.dataset.tab.startsWith('team-')) {
                teamId = activeTab.dataset.tab.replace('team-', '');
            }

            const taskData = {
                title: document.getElementById('task-title-input').value,
                description: document.getElementById('task-description-input').value,
                deadline: document.getElementById('task-deadline-input').value || null,
                team_id: teamId,
            };

            const url = currentEditingTaskId ? `/api/tasks/${currentEditingTaskId}` : '/api/tasks';
            const method = currentEditingTaskId ? 'PUT' : 'POST';

            // Блокуємо кнопку
            const btn = taskForm.querySelector('button[type="submit"]');
            const originalText = btn.innerText;
            btn.innerText = "Збереження...";
            btn.disabled = true;

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData),
                });

                if (response.ok) {
                    closeModal();
                    fetchAndRenderTasks();
                } else {
                    const error = await response.json();
                    alert(`Помилка: ${error.message || error.error || 'Unknown error'}`);
                }
            } catch (error) {
                console.error('Error saving task:', error);
                alert("Помилка з'єднання");
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });
    }

    const toggleTaskComplete = async (task) => {
        try {
            await fetch(`/api/tasks/${task.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_completed: !task.is_completed ? 1 : 0 })
            });
            fetchAndRenderTasks();
        } catch (error) {
            console.error('Error toggling task:', error);
        }
    };

    const deleteTask = async (taskId) => {
        if (!confirm('Ви впевнені, що хочете видалити цю задачу?')) return;
        try {
            await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
            fetchAndRenderTasks();
        } catch (error) {
            console.error('Error deleting task:', error);
        }
    };

    // --- CONTEXT MENU ---
    document.addEventListener('click', () => {
        if(contextMenu) contextMenu.classList.add('hidden');
    });

    if (contextMenu) {
        contextMenu.addEventListener('click', (e) => {
            if (!currentContextMenuTask) return;
            const action = e.target.dataset.action;

            if (action === 'toggle-complete') {
                toggleTaskComplete(currentContextMenuTask);
            } else if (action === 'edit') {
                openModal(currentContextMenuTask);
            } else if (action === 'delete') {
                deleteTask(currentContextMenuTask.id);
            }
        });
    }

    // Initial load
    fetchAndRenderTasks();
});

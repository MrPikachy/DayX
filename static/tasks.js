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
            document.getElementById('task-deadline-input').value = task.deadline ? task.deadline.slice(0, 16) : '';
        } else {
            document.getElementById('modal-title').textContent = 'Створити задачу';
        }
        taskModal.classList.remove('hidden');
    };

    const closeModal = () => {
        taskModal.classList.add('hidden');
    };

    createTaskBtn.addEventListener('click', () => openModal());
    cancelTaskBtn.addEventListener('click', closeModal);
    taskModal.addEventListener('click', (e) => {
        if (e.target === taskModal) closeModal();
    });

    // --- API & RENDERING ---
    const fetchAndRenderTasks = async () => {
        try {
            const response = await fetch('/api/tasks');
            if (!response.ok) throw new Error('Failed to fetch tasks');
            const tasks = await response.json();
            
            document.querySelectorAll('.tasks-list').forEach(list => list.innerHTML = '');

            tasks.forEach(task => {
                const listId = `${task.is_completed ? 'completed' : 'active'}-${task.team_id ? 'team-' + task.team_id : 'personal'}`;
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

        const deadlineStr = task.deadline ? new Date(task.deadline).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Без дедлайну';
        const isUrgent = !task.is_completed && task.deadline && new Date(task.deadline) < new Date();

        card.innerHTML = `
            <div class="task-title">${task.title}</div>
            ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
            <div class="task-deadline ${isUrgent ? 'urgent' : ''}">${deadlineStr}</div>
        `;

        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            currentContextMenuTask = task;
            contextMenu.style.top = `${e.clientY}px`;
            contextMenu.style.left = `${e.clientX}px`;
            contextMenu.classList.remove('hidden');
        });

        return card;
    };

    // --- CRUD ---
    taskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const activeTab = document.querySelector('.tab-btn.active');
        const teamId = activeTab.dataset.tab.startsWith('team-') ? activeTab.dataset.tab.replace('team-', '') : null;

        const taskData = {
            title: document.getElementById('task-title-input').value,
            description: document.getElementById('task-description-input').value,
            deadline: document.getElementById('task-deadline-input').value || null,
            team_id: teamId,
        };

        const url = currentEditingTaskId ? `/api/task/${currentEditingTaskId}` : '/api/task';
        const method = currentEditingTaskId ? 'PUT' : 'POST';

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
                alert(`Помилка: ${error.message}`);
            }
        } catch (error) {
            console.error('Error saving task:', error);
        }
    });

    const toggleTaskComplete = async (taskId) => {
        try {
            await fetch(`/api/task/${taskId}/toggle`, { method: 'POST' });
            fetchAndRenderTasks();
        } catch (error) {
            console.error('Error toggling task:', error);
        }
    };

    const deleteTask = async (taskId) => {
        if (!confirm('Ви впевнені, що хочете видалити цю задачу?')) return;
        try {
            await fetch(`/api/task/${taskId}`, { method: 'DELETE' });
            fetchAndRenderTasks();
        } catch (error) {
            console.error('Error deleting task:', error);
        }
    };

    // --- CONTEXT MENU ---
    document.addEventListener('click', () => {
        contextMenu.classList.add('hidden');
    });

    contextMenu.addEventListener('click', (e) => {
        if (!currentContextMenuTask) return;
        const action = e.target.dataset.action;

        if (action === 'toggle-complete') {
            toggleTaskComplete(currentContextMenuTask.id);
        } else if (action === 'edit') {
            openModal(currentContextMenuTask);
        } else if (action === 'delete') {
            deleteTask(currentContextMenuTask.id);
        }
    });

    // Initial load
    fetchAndRenderTasks();
});

document.addEventListener('DOMContentLoaded', () => {
    const calendar = document.getElementById('calendar');
    const monthLabel = document.getElementById('month-label');
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');
    const todayBtn = document.getElementById('today-btn');
    const subgroup1Btn = document.getElementById('subgroup-btn-1');
    const subgroup2Btn = document.getElementById('subgroup-btn-2');

    // Модальні вікна
    const eventModal = document.getElementById('modal');
    const dayDetailModal = document.getElementById('day-detail-modal');
    const infoModal = document.getElementById('modal-event-info'); // Нове вікно деталей

    // Контекстні меню
    const eventContextMenu = document.getElementById('event-context-menu');
    const emptyContextMenu = document.getElementById('empty-context-menu');

    let currentDate = new Date();
    let currentSubgroup = window.CURRENT_USER_SUBGROUP || 1;
    let allEvents = [];

    // Змінні для редагування
    let editingEventId = null;
    let editingEventDate = null;
    let currentContextMenuEvent = null; // Зберігаємо подію, на якій клікнули ПКМ

    const MAX_EVENTS_VISIBLE = 3;

    // --- API ---
    const fetchSchedule = async () => {
        try {
            const group = window.CURRENT_USER_GROUP;
            if (!group) return;
            const response = await fetch(`/api/schedule/${group}?subgroup=${currentSubgroup}`);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            allEvents = data.events || [];
            renderCalendar();
        } catch (error) {
            console.error("Error fetching schedule:", error);
        }
    };

    // --- RENDER ---
    const renderCalendar = () => {
        calendar.innerHTML = '';
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const monthName = currentDate.toLocaleString("uk-UA", { month: "long", year: "numeric" });
        monthLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

        const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayStr = new Date().toDateString();

        // Порожні клітинки до 1 числа
        for (let i = 0; i < firstDayIndex; i++) {
            calendar.insertAdjacentHTML('beforeend', '<div class="calendar-day empty"></div>');
        }

        // Дні місяця
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toISOString().split('T')[0];
            const dayCell = document.createElement('div');
            dayCell.className = `calendar-day ${date.toDateString() === todayStr ? 'today' : ''}`;
            dayCell.dataset.date = dateStr;

            dayCell.innerHTML = `<div class="day-number">${day}</div><div class="day-events"></div>`;

            const dayEventsContainer = dayCell.querySelector('.day-events');

            // Фільтруємо події для цього дня
            const dayEvents = allEvents.filter(e => e.start && new Date(e.start).toDateString() === date.toDateString())
                                     .sort((a, b) => (a.start || "").localeCompare(b.start || ""));

            // Рендеримо перші N подій
            dayEvents.slice(0, MAX_EVENTS_VISIBLE).forEach(event => {
                dayEventsContainer.appendChild(createEventElement(event));
            });

            // Якщо подій більше, показуємо "+X більше"
            if (dayEvents.length > MAX_EVENTS_VISIBLE) {
                const moreLink = document.createElement('div');
                moreLink.className = 'day-more-link';
                moreLink.textContent = `+${dayEvents.length - MAX_EVENTS_VISIBLE} більше`;
                moreLink.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openDayDetailModal(date, dayEvents);
                });
                dayEventsContainer.appendChild(moreLink);
            }

            // ПКМ по порожньому місцю в дні
            dayCell.addEventListener('contextmenu', (e) => {
                if (e.target.closest('.day-event')) return;
                e.preventDefault();
                showContextMenu('empty', dateStr, null, e);
            });

            calendar.appendChild(dayCell);
        }
    };

    const createEventElement = (event) => {
        const el = document.createElement('div');
        const typeClass = event.className && event.className.length > 0 ? event.className[0] : 'event-other';
        el.className = `day-event ${typeClass}`;

        const title = event.title || "Подія";
        const startTime = event.start ? new Date(event.start).toTimeString().substring(0, 5) : "";
        el.textContent = startTime ? `${startTime} ${title}` : title;

        // ПКМ по події
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            currentContextMenuEvent = event; // Зберігаємо подію
            showContextMenu('event', null, event, e);
        });

        // ЛКМ по події (можна теж відкривати деталі)
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            // Якщо це університетська пара - деталі, якщо власна - редагування (або теж деталі, як зручніше)
            if (event.extendedProps && event.extendedProps.is_custom) {
                // Можна відкрити редагування
                 editingEventId = event.id.replace('custom_', '');
                 openEventModal(event);
            } else {
                showEventInfo(event);
            }
        });

        return el;
    };

    // --- CONTEXT MENU LOGIC ---
    const showContextMenu = (type, dateStr, event, mouseEvent) => {
        hideContextMenus();
        let menu;

        if (type === 'event') {
            menu = eventContextMenu;

            // Логіка: Що показувати в меню?
            const isCustom = event.extendedProps && event.extendedProps.is_custom;

            const viewBtn = document.getElementById('view-details-btn');
            const editBtn = document.getElementById('edit-event-btn');
            const editTimeBtn = document.getElementById('edit-time-btn');
            const deleteBtn = document.getElementById('delete-event-btn');

            if (isCustom) {
                // Власна подія: Дозволяємо редагувати/видаляти
                viewBtn.style.display = 'none';
                editBtn.style.display = 'block';
                editTimeBtn.style.display = 'block';
                deleteBtn.style.display = 'block';
                editingEventId = event.id.replace('custom_', ''); // ID для API
            } else {
                // Університетська пара: Тільки перегляд
                viewBtn.style.display = 'block';
                editBtn.style.display = 'none';
                editTimeBtn.style.display = 'none';
                deleteBtn.style.display = 'none';
            }

        } else {
            menu = emptyContextMenu;
            editingEventDate = dateStr;
        }

        // Позиціонування (щоб не вилазило за екран)
        const x = Math.min(mouseEvent.clientX, window.innerWidth - 200);
        const y = Math.min(mouseEvent.clientY, window.innerHeight - 150);

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
    };

    const hideContextMenus = () => {
        eventContextMenu.classList.add('hidden');
        emptyContextMenu.classList.add('hidden');
    };

    // --- VIEW DETAILS MODAL (Оновлено для Дедлайнів) ---
    const showEventInfo = (event) => {
        const content = document.getElementById('event-info-content');
        const modalHeader = document.querySelector('#modal-event-info .modal-header'); // Знаходимо заголовок вікна

        // Форматуємо час
        const startTime = event.start ? new Date(event.start).toTimeString().substring(0, 5) : "-";
        const endTime = event.end ? new Date(event.end).toTimeString().substring(0, 5) : "";
        const timeDisplay = endTime ? `${startTime} - ${endTime}` : startTime;

        // --- ВАРІАНТ 1: ДЕДЛАЙН ---
        if (event.extendedProps.type === 'task_deadline') {
            modalHeader.textContent = "Деталі дедлайну"; // Змінюємо назву вікна

            const description = event.extendedProps.description || "Опис відсутній";

            content.innerHTML = `
                <h3 style="margin-top:0; color:white; font-size: 1.4rem; border-bottom: 1px solid #333; padding-bottom: 10px;">
                    ${event.title}
                </h3>

                <div style="margin-top: 15px; font-size: 1rem; display: flex; flex-direction: column; gap: 12px;">
                    <div>
                        <span style="color: #888;">⏳ Термін:</span>
                        <span style="color: #ef4444; font-weight: bold; margin-left: 8px;">${timeDisplay}</span>
                    </div>

                    <div>
                        <span style="color: #888;">📌 Тип:</span>
                        <span style="color: #fff; margin-left: 8px;">Дедлайн</span>
                    </div>

                    <div>
                        <div style="color: #888; margin-bottom: 5px;">📝 Опис завдання:</div>
                        <div style="color: #ddd; background: #222; padding: 10px; border-radius: 8px; font-size: 0.95rem; line-height: 1.5;">
                            ${description}
                        </div>
                    </div>
                </div>
            `;

        // --- ВАРІАНТ 2: ЗВИЧАЙНА ПАРА ---
        } else {
            modalHeader.textContent = "Деталі пари"; // Повертаємо стандартну назву

            let rawLocation = event.extendedProps.location || "";
            let type = event.extendedProps.type || "Подія";

            let teacher = "Не вказано";
            let room = rawLocation;

            // Логіка розділення (якщо це пара з університету)
            if (rawLocation.includes(',')) {
                const parts = rawLocation.split(',');
                if (parts.length >= 2) {
                    teacher = parts[0].trim();
                    let rest = parts.slice(1).join(',').trim();
                    room = rest.replace(new RegExp(type, 'i'), '').replace(/,$/, '').trim();
                }
            }

            // Якщо це власна подія
            if (event.extendedProps.is_custom) {
                teacher = "-";
                room = rawLocation || "Локація не вказана";
            }

            content.innerHTML = `
                <h3 style="margin-top:0; color:white; font-size: 1.4rem; border-bottom: 1px solid #333; padding-bottom: 10px;">${event.title}</h3>

                <div style="display: grid; grid-template-columns: auto 1fr; gap: 10px; margin-top: 15px; font-size: 1rem;">
                    <div style="color: #888;">⏳ Час:</div>
                    <div style="color: #fff; font-weight: bold;">${timeDisplay}</div>

                    <div style="color: #888;">📌 Тип:</div>
                    <div style="color: #fff;">${type}</div>

                    <div style="color: #888;">🎓 Викладач:</div>
                    <div style="color: #60a5fa;">${teacher}</div>

                    <div style="color: #888;">📍 Аудиторія:</div>
                    <div style="color: #fff;">${room}</div>
                </div>
            `;
        }

        // Показуємо модальне вікно
        document.getElementById('modal-event-info').classList.remove('hidden');
    };

    // --- Інші функції (Modals, API) ---

    const openDayDetailModal = (date, events) => {
        const modalTitle = dayDetailModal.querySelector('#day-detail-title');
        const modalList = dayDetailModal.querySelector('#day-detail-list');

        modalTitle.textContent = `Події на ${date.toLocaleDateString('uk-UA')}`;
        modalList.innerHTML = '';

        events.forEach(event => {
            modalList.appendChild(createEventElement(event));
        });

        dayDetailModal.classList.remove('hidden');
    };

    const openEventModal = (event = null) => {
        const form = document.getElementById('event-form');
        form.reset();

        if (event) {
            // Редагування
            document.getElementById('modal-title').textContent = 'Редагувати подію';
            document.getElementById('ev-title').value = event.title;
            document.getElementById('ev-date').value = event.start.split('T')[0];
            document.getElementById('ev-start').value = event.start.split('T')[1].substring(0,5);
            // Якщо є кінець - ставимо, якщо ні - порожньо
            const endVal = event.end ? event.end.split('T')[1].substring(0,5) : "";
            document.getElementById('ev-end').value = endVal;
        } else {
            // Створення
            editingEventId = null;
            document.getElementById('modal-title').textContent = 'Нова подія';
            document.getElementById('ev-date').value = editingEventDate;
        }
        eventModal.classList.remove('hidden');
    };

    const saveEvent = async (e) => {
        e.preventDefault();
        const eventData = {
            id: editingEventId,
            title: document.getElementById('ev-title').value,
            date: document.getElementById('ev-date').value,
            start_time: document.getElementById('ev-start').value,
            end_time: document.getElementById('ev-end').value,
            group_name: window.CURRENT_USER_GROUP,
            type: 'other' // За замовчуванням
        };

        try {
            const response = await fetch("/api/event", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(eventData),
            });
            if (response.ok) {
                eventModal.classList.add('hidden');
                fetchSchedule();
            }
        } catch (error) {
            console.error("Save error:", error);
        }
    };

    const deleteEvent = async () => {
        if (!editingEventId || !confirm("Видалити подію?")) return;
        try {
            const response = await fetch(`/api/event/${editingEventId}`, { method: "DELETE" });
            if (response.ok) {
                fetchSchedule();
            }
        } catch (e) {
            console.error(e);
        }
    };

    // --- Listeners Setup ---
    const setupEventListeners = () => {
        prevMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
        nextMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
        todayBtn.addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });

        subgroup1Btn.addEventListener('click', () => switchSubgroup(1));
        subgroup2Btn.addEventListener('click', () => switchSubgroup(2));

        document.addEventListener('click', hideContextMenus);

        // Modals closing
        dayDetailModal.querySelector('#day-detail-close').addEventListener('click', () => dayDetailModal.classList.add('hidden'));
        eventModal.querySelector('#cancel-ev').addEventListener('click', () => eventModal.classList.add('hidden'));

        // Closing Info Modal
        document.getElementById('close-info-btn').addEventListener('click', () => infoModal.classList.add('hidden'));
        infoModal.addEventListener('click', (e) => { if (e.target === infoModal) infoModal.classList.add('hidden'); });

        // Save Form
        document.getElementById('event-form').addEventListener('submit', saveEvent);

        // Context Menu Actions
        document.getElementById('add-event-btn').addEventListener('click', () => openEventModal());

        document.getElementById('edit-event-btn').addEventListener('click', () => {
             // Беремо подію зі збереженої змінної
            if(currentContextMenuEvent) {
                 editingEventId = currentContextMenuEvent.id.replace('custom_', '');
                 openEventModal(currentContextMenuEvent);
            }
        });

        document.getElementById('delete-event-btn').addEventListener('click', () => {
             if(currentContextMenuEvent) {
                 editingEventId = currentContextMenuEvent.id.replace('custom_', '');
                 deleteEvent();
             }
        });

        // View Details Btn
        document.getElementById('view-details-btn').addEventListener('click', () => {
            if (currentContextMenuEvent) {
                showEventInfo(currentContextMenuEvent);
            }
        });
    };

    const switchSubgroup = (subgroup) => {
        if (currentSubgroup === subgroup) return;
        currentSubgroup = subgroup;
        updateSubgroupUI();
        fetchSchedule();
    };

    const updateSubgroupUI = () => {
        if (currentSubgroup == 1) {
            subgroup1Btn.classList.add('active');
            subgroup2Btn.classList.remove('active');
        } else {
            subgroup1Btn.classList.remove('active');
            subgroup2Btn.classList.add('active');
        }
    };

    setupEventListeners();
    fetchSchedule();
});

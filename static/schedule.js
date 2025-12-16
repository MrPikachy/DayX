document.addEventListener('DOMContentLoaded', () => {
    const calendar = document.getElementById('calendar');
    const monthLabel = document.getElementById('month-label');
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');
    const todayBtn = document.getElementById('today-btn');
    const subgroup1Btn = document.getElementById('subgroup-btn-1');
    const subgroup2Btn = document.getElementById('subgroup-btn-2');

    const eventModal = document.getElementById('modal');
    const dayDetailModal = document.getElementById('day-detail-modal');
    const eventContextMenu = document.getElementById('event-context-menu');
    const emptyContextMenu = document.getElementById('empty-context-menu');

    let currentDate = new Date();
    let currentSubgroup = window.CURRENT_USER_SUBGROUP || 1;
    let allEvents = [];
    let editingEventId = null;
    let editingEventDate = null;
    
    const MAX_EVENTS_VISIBLE = 3;

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

    const renderCalendar = () => {
        calendar.innerHTML = '';
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const monthName = currentDate.toLocaleString("uk-UA", { month: "long", year: "numeric" });
        monthLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

        const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayStr = new Date().toDateString();

        for (let i = 0; i < firstDayIndex; i++) {
            calendar.insertAdjacentHTML('beforeend', '<div class="calendar-day empty"></div>');
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toISOString().split('T')[0];
            const dayCell = document.createElement('div');
            dayCell.className = `calendar-day ${date.toDateString() === todayStr ? 'today' : ''}`;
            dayCell.dataset.date = dateStr;

            dayCell.innerHTML = `<div class="day-number">${day}</div><div class="day-events"></div>`;
            
            const dayEventsContainer = dayCell.querySelector('.day-events');
            const dayEvents = allEvents.filter(e => e.start && new Date(e.start).toDateString() === date.toDateString())
                                     .sort((a, b) => (a.start || "").localeCompare(b.start || ""));

            dayEvents.slice(0, MAX_EVENTS_VISIBLE).forEach(event => {
                dayEventsContainer.appendChild(createEventElement(event));
            });

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
        el.dataset.eventId = event.id;
        
        const title = event.title || "Подія";
        const startTime = event.start ? new Date(event.start).toTimeString().substring(0, 5) : "";
        el.textContent = startTime ? `${startTime} ${title}` : title;

        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu('event', null, event, e);
        });
        
        return el;
    };

    const showContextMenu = (type, dateStr, event, mouseEvent) => {
        hideContextMenus();
        let menu;
        if (type === 'event') {
            menu = eventContextMenu;
            editingEventId = event.id;
        } else {
            menu = emptyContextMenu;
            editingEventDate = dateStr;
        }
        menu.style.left = `${mouseEvent.clientX}px`;
        menu.style.top = `${mouseEvent.clientY}px`;
        menu.classList.remove('hidden');
    };

    const hideContextMenus = () => {
        eventContextMenu.classList.add('hidden');
        emptyContextMenu.classList.add('hidden');
    };

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
        editingEventId = null;

        if (event) {
            editingEventId = event.id.replace('custom_', '');
            document.getElementById('modal-title').textContent = 'Редагувати подію';
            document.getElementById('ev-title').value = event.title;
            document.getElementById('ev-date').value = event.start.split('T')[0];
            document.getElementById('ev-start').value = event.start.split('T')[1].substring(0,5);
            document.getElementById('ev-end').value = event.end.split('T')[1].substring(0,5);
        } else {
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
            type: 'other'
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

    const setupEventListeners = () => {
        prevMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
        nextMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
        todayBtn.addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });
        
        subgroup1Btn.addEventListener('click', () => switchSubgroup(1));
        subgroup2Btn.addEventListener('click', () => switchSubgroup(2));

        document.addEventListener('click', hideContextMenus);
        
        // Modals
        dayDetailModal.querySelector('#day-detail-close').addEventListener('click', () => dayDetailModal.classList.add('hidden'));
        dayDetailModal.addEventListener('click', (e) => { if (e.target === dayDetailModal) dayDetailModal.classList.add('hidden'); });
        eventModal.querySelector('#cancel-ev').addEventListener('click', () => eventModal.classList.add('hidden'));
        eventModal.addEventListener('click', (e) => { if (e.target === eventModal) eventModal.classList.add('hidden'); });
        document.getElementById('event-form').addEventListener('submit', saveEvent);

        // Context Menus
        document.getElementById('add-event-btn').addEventListener('click', () => openEventModal());
        document.getElementById('edit-event-btn').addEventListener('click', () => {
            const event = allEvents.find(e => e.id === editingEventId);
            openEventModal(event);
        });
        document.getElementById('delete-event-btn').addEventListener('click', deleteEvent);
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

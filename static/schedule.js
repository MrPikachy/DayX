const LPNU_API = "https://student.lpnu.ua/students_schedule"
let currentDate = new Date()
const currentGroup = window.CURRENT_USER_GROUP
let currentSubgroup = (typeof window.CURRENT_USER_SUBGROUP !== 'undefined') ? parseInt(window.CURRENT_USER_SUBGROUP, 10) : 1;
if (isNaN(currentSubgroup) || (currentSubgroup !== 1 && currentSubgroup !== 2)) currentSubgroup = 1;

let allEvents = []
let editingEventId = null
let editingEventDate = null

// --- Helper Functions ---
function getRawId(id) {
  if (!id) return null;
  return String(id).replace("custom_", "").replace("lpnu_", "").replace("task_", "");
}

function formatDate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getFirstDayOfMonth(d) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  return (first.getDay() + 6) % 7
}

// --- Main Init ---
async function initCalendar() {
  if (!currentGroup) return;
  setupEventListeners()
  setupSubgroupSwitcher()
  updateSubgroupUI()
  await fetchSchedule()
  renderCalendar()
}

// --- Data Fetching ---
async function fetchSchedule() {
  try {
    const response = await fetch(`/api/schedule/${currentGroup}?subgroup=${currentSubgroup}`)
    if (!response.ok) throw new Error("Network response was not ok");
    const data = await response.json()
    allEvents = data.events || []
  } catch (error) {
    console.error("Error fetching schedule:", error)
    allEvents = []
  }
}

function getEventsForDate(dateStr) {
  return allEvents.filter((e) => {
    if (!e.start) return false;
    const eventDate = e.start.split("T")[0]
    return eventDate === dateStr
  })
}

// --- Rendering ---
function renderCalendar() {
  const monthLabel = document.getElementById("month-label")
  const calendar = document.getElementById("calendar")
  if (!calendar) return;
  calendar.innerHTML = ""

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const monthName = currentDate.toLocaleString("uk-UA", { month: "long", year: "numeric" })
  monthLabel.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1)

  const firstDayIndex = getFirstDayOfMonth(currentDate)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStr = formatDate(new Date())

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement("div")
    emptyCell.className = "calendar-day empty"
    calendar.appendChild(emptyCell)
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    const dateStr = formatDate(date)
    const isToday = (dateStr === todayStr)

    const dayCell = document.createElement("div")
    dayCell.className = `calendar-day ${isToday ? "today" : ""}`
    dayCell.dataset.date = dateStr

    const dayNum = document.createElement("div")
    dayNum.className = "day-number"
    dayNum.textContent = day
    dayCell.appendChild(dayNum)

    const eventsContainer = document.createElement("div")
    eventsContainer.className = "day-events"

    const dayEvents = getEventsForDate(dateStr)
    dayEvents.sort((a, b) => (a.start || "").localeCompare(b.start || ""))

    dayEvents.forEach((event) => {
      const eventEl = createEventElement(event, dateStr)
      eventsContainer.appendChild(eventEl)
    })

    dayCell.appendChild(eventsContainer)

    dayCell.addEventListener("contextmenu", (e) => {
      if (!e.target.closest(".day-event")) {
        e.preventDefault()
        showContextMenu("empty", dateStr, null, e)
      }
    })
    calendar.appendChild(dayCell)
  }
}

function createEventElement(event, dateStr) {
  const el = document.createElement("div")
  let typeClass = "event-other"
  if (event.className && event.className.length > 0) typeClass = event.className[0]

  const isCustom = (event.extendedProps && event.extendedProps.is_custom === 1);
  const isTask = (event.extendedProps && event.extendedProps.type === 'task_deadline');

  el.className = `day-event ${typeClass} ${isCustom ? "custom" : ""}`
  el.dataset.eventId = event.id

  const title = event.title || "Подія"
  const startTime = event.start ? (event.start.split("T")[1] || "").substring(0,5) : ""

  // Для дедлайнів показуємо просто час або іконку
  let displayTime = startTime;

  // Обрізання тексту
  let displayText = title
  if (displayText.length > 20) displayText = displayText.substring(0, 19) + "…"
  if (displayTime && !event.allDay) displayText = `${displayText} (${displayTime})`

  el.textContent = displayText

  // ЛКМ
  el.addEventListener("click", (ev) => {
    ev.preventDefault()
    ev.stopPropagation()

    // --- ЗМІНА 2: Дедлайни тепер відкривають модалку ---
    if (isTask) {
        openViewModal(event)
        return;
    }

    if (isCustom) {
        openFullModal(dateStr, event)
    } else {
        openViewModal(event)
    }
  })

  // ПКМ
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (isTask) return;
    if (isCustom) {
      showContextMenu("event", dateStr, event, e)
    } else {
      openViewModal(event) // ПКМ по парі теж відкриває деталі
    }
  })

  return el
}

// --- Context Menus ---
function showContextMenu(type, dateStr, event, mouseEvent) {
  const eventMenu = document.getElementById("event-context-menu")
  const emptyMenu = document.getElementById("empty-context-menu")
  if(eventMenu) eventMenu.classList.add("hidden")
  if(emptyMenu) emptyMenu.classList.add("hidden")

  if (type === "event" && event && eventMenu) {
    editingEventId = event.id
    editingEventDate = dateStr
    eventMenu.style.left = mouseEvent.clientX + "px"
    eventMenu.style.top = mouseEvent.clientY + "px"
    eventMenu.classList.remove("hidden")
  } else if (type === "empty" && emptyMenu) {
    editingEventDate = dateStr
    editingEventId = null
    emptyMenu.style.left = mouseEvent.clientX + "px"
    emptyMenu.style.top = mouseEvent.clientY + "px"
    emptyMenu.classList.remove("hidden")
  }
}

// --- Modals ---
function closeModal() {
  const modal = document.getElementById("modal")
  const inputs = modal.querySelectorAll("input, textarea, button")
  inputs.forEach(i => i.removeAttribute("disabled"))

  const saveBtn = document.getElementById("save-ev")
  if(saveBtn) saveBtn.style.display = ""

  const cancelBtn = document.getElementById("cancel-ev")
  if(cancelBtn) cancelBtn.textContent = "Скасувати"

  // Reset fields
  document.getElementById("ev-title").value = ""
  document.getElementById("ev-desc").value = ""
  document.getElementById("desc-group").style.display = "none"

  modal.classList.add("hidden")
  editingEventId = null
  editingEventDate = null
}

function openFullModal(dateStr, eventData = null) {
  const modal = document.getElementById("modal")
  const title = document.getElementById("modal-title")

  const titleInput = document.getElementById("ev-title")
  const dateInput = document.getElementById("ev-date")
  const startInput = document.getElementById("ev-start")
  const endInput = document.getElementById("ev-end")

  const isCustom = eventData && (String(eventData.id).startsWith("custom_") || (eventData.extendedProps && eventData.extendedProps.is_custom));

  if (isCustom) {
    title.textContent = "Редагувати"
    titleInput.value = eventData.title || ""
    dateInput.value = eventData.start ? eventData.start.split("T")[0] : dateStr
    startInput.value = eventData.start ? eventData.start.substring(11, 16) : ""
    endInput.value = eventData.end ? eventData.end.substring(11, 16) : ""
    editingEventId = eventData.id
  } else {
    title.textContent = "Нова подія"
    titleInput.value = ""
    dateInput.value = dateStr
    startInput.value = "10:00"
    endInput.value = "11:30"
    editingEventId = null
  }

  editingEventDate = dateStr
  modal.classList.remove("hidden")
  titleInput.focus()
}

function openViewModal(event) {
  const modal = document.getElementById("modal")
  const title = document.getElementById("modal-title")
  const saveBtn = document.getElementById("save-ev")
  const cancelBtn = document.getElementById("cancel-ev")

  // Поля
  const titleIn = document.getElementById("ev-title");
  const descIn = document.getElementById("ev-desc");
  const descGroup = document.getElementById("desc-group");
  const startIn = document.getElementById("ev-start");
  const endIn = document.getElementById("ev-end");
  const dateIn = document.getElementById("ev-date");

  const isTask = (event.extendedProps && event.extendedProps.type === 'task_deadline');

  title.textContent = isTask ? "Дедлайн" : "Деталі пари"

  // Заповнюємо даними
  titleIn.value = event.title.replace("⏰ ", "") || ""
  dateIn.value = event.start ? event.start.split("T")[0] : ""
  startIn.value = event.start ? event.start.substring(11,16) : ""
  endIn.value = event.end ? event.end.substring(11,16) : ""

  // --- ЗМІНА 3: Показуємо опис, якщо це задача ---
  if (isTask && event.extendedProps.description) {
      descGroup.style.display = "block"
      descIn.value = event.extendedProps.description
  } else {
      descGroup.style.display = "none"
  }

  // Блокуємо інпути
  modal.querySelectorAll("input, textarea").forEach(el => el.setAttribute("disabled", "disabled"))

  saveBtn.style.display = "none"
  cancelBtn.textContent = "Закрити"

  modal.classList.remove("hidden")
}

// --- Subgroup Switcher ---
function setupSubgroupSwitcher() {
  const btn1 = document.getElementById("subgroup-btn-1")
  const btn2 = document.getElementById("subgroup-btn-2")
  if(!btn1 || !btn2) return;
  btn1.onclick = () => handleSubgroupChange(1);
  btn2.onclick = () => handleSubgroupChange(2);
}

function handleSubgroupChange(newSubgroup) {
    if (currentSubgroup === newSubgroup) return;
    currentSubgroup = newSubgroup;
    updateSubgroupUI();
    saveUserSubgroup(newSubgroup);
    fetchSchedule().then(() => renderCalendar());
}

function updateSubgroupUI() {
  const btn1 = document.getElementById("subgroup-btn-1")
  const btn2 = document.getElementById("subgroup-btn-2")
  if(!btn1 || !btn2) return;
  if (currentSubgroup === 1) {
    btn1.classList.add("subgroup-active"); btn2.classList.remove("subgroup-active")
  } else {
    btn1.classList.remove("subgroup-active"); btn2.classList.add("subgroup-active")
  }
}

async function saveUserSubgroup(subgroup) {
  try {
    const formData = new FormData();
    formData.append('subgroup', subgroup);
    await fetch("/api/user/subgroup", { method: "POST", body: formData })
  } catch (e) { console.error(e) }
}

// --- Event Handlers & CRUD ---
function setupEventListeners() {
  document.getElementById("today-btn")?.addEventListener("click", () => {
    currentDate = new Date(); renderCalendar()
  })
  document.getElementById("prev-month")?.addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar()
  })
  document.getElementById("next-month")?.addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar()
  })

  document.getElementById("add-event-btn")?.addEventListener("click", () => {
    document.getElementById("empty-context-menu").classList.add("hidden")
    openFullModal(editingEventDate)
  })

  document.getElementById("edit-event-btn")?.addEventListener("click", () => {
    document.getElementById("event-context-menu").classList.add("hidden")
    openEditNameModal()
  })
  document.getElementById("edit-time-btn")?.addEventListener("click", () => {
    document.getElementById("event-context-menu").classList.add("hidden")
    openEditTimeModal()
  })
  document.getElementById("delete-event-btn")?.addEventListener("click", deleteEvent)

  document.getElementById("save-ev")?.addEventListener("click", saveEvent)
  document.getElementById("cancel-ev")?.addEventListener("click", closeModal)
  document.querySelectorAll(".modal-close").forEach(b => b.addEventListener("click", closeModal))
  document.querySelectorAll(".modal-overlay").forEach(o => o.addEventListener("click", closeModal))

  document.addEventListener("click", () => {
    const em = document.getElementById("event-context-menu");
    const emp = document.getElementById("empty-context-menu");
    if(em) em.classList.add("hidden");
    if(emp) emp.classList.add("hidden");
  })

  document.getElementById("save-edit-name")?.addEventListener("click", saveEventName)
  document.getElementById("cancel-edit-name")?.addEventListener("click", () => document.getElementById("modal-edit-name").classList.add("hidden"))
  document.getElementById("save-edit-time")?.addEventListener("click", saveEventTime)
  document.getElementById("cancel-edit-time")?.addEventListener("click", () => document.getElementById("modal-edit-time").classList.add("hidden"))
}

async function saveEvent() {
  const title = document.getElementById("ev-title").value
  if (!title.trim()) { alert("Введіть назву!"); return }

  const eventData = {
    id: getRawId(editingEventId),
    group_name: currentGroup,
    title: title,
    type: "other", // --- ЗМІНА 4: Тип за замовчуванням "Інше" ---
    date: document.getElementById("ev-date").value,
    start_time: document.getElementById("ev-start").value,
    end_time: document.getElementById("ev-end").value,
  }

  try {
    const response = await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    })
    if (response.ok) {
      closeModal()
      await fetchSchedule()
      renderCalendar()
    }
  } catch (error) { console.error("Save error:", error) }
}

async function deleteEvent() {
  if (!editingEventId || !confirm("Видалити подію?")) return
  try {
    const response = await fetch(`/api/event/${getRawId(editingEventId)}`, { method: "DELETE" })
    if (response.ok) {
        document.getElementById("event-context-menu").classList.add("hidden")
        await fetchSchedule()
        renderCalendar()
    }
  } catch (e) { console.error(e) }
}

async function saveEventName() {
    const newVal = document.getElementById("edit-name-input").value;
    if(!newVal) return;
    const evt = allEvents.find(e => e.id == editingEventId);
    if(!evt) return;

    const data = {
        id: getRawId(editingEventId),
        group_name: currentGroup,
        title: newVal,
        type: (evt.extendedProps && evt.extendedProps.type) || 'other',
        date: evt.start.split('T')[0],
        start_time: evt.start.substring(11,16),
        end_time: evt.end.substring(11,16)
    };
    await fetch("/api/event", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data)
    });
    document.getElementById("modal-edit-name").classList.add("hidden");
    await fetchSchedule(); renderCalendar();
}

function openEditNameModal() {
    const evt = allEvents.find(e => e.id == editingEventId);
    if(!evt) return;
    document.getElementById("edit-name-input").value = evt.title;
    document.getElementById("modal-edit-name").classList.remove("hidden");
}

function openEditTimeModal() {
    const evt = allEvents.find(e => e.id == editingEventId);
    if(!evt) return;
    document.getElementById("edit-time-start").value = evt.start.substring(11,16);
    document.getElementById("edit-time-end").value = evt.end.substring(11,16);
    document.getElementById("modal-edit-time").classList.remove("hidden");
}

async function saveEventTime() {
    const s = document.getElementById("edit-time-start").value;
    const e_time = document.getElementById("edit-time-end").value;
    const evt = allEvents.find(e => e.id == editingEventId);
    if(!evt) return;

    const data = {
        id: getRawId(editingEventId),
        group_name: currentGroup,
        title: evt.title,
        type: (evt.extendedProps && evt.extendedProps.type) || 'other',
        date: evt.start.split('T')[0],
        start_time: s, end_time: e_time
    };
    await fetch("/api/event", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data)
    });
    document.getElementById("modal-edit-time").classList.add("hidden");
    await fetchSchedule(); renderCalendar();
}

document.addEventListener("DOMContentLoaded", initCalendar)
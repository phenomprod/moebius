const events = require("events");
let visible = false;
const statuses = {ACTIVE: 0, IDLE: 1, AWAY: 2, WEB: 3};
const electron = require("electron");
const {send} = require("../../senders");
require("linkifyjs/plugins/ticket")(require("linkifyjs"));
const linkify_string = require("linkifyjs/string");
let last_height = 240;

function $(name) {
    return document.getElementById(name);
}

function set_var(name, value) {
    document.documentElement.style.setProperty(`--${name}`, `${value}px`);
}

function is_at_bottom() {
    const messages = $("messages");
    const rect = messages.getBoundingClientRect();
    return (rect.height > messages.scrollHeight) || (messages.scrollTop == messages.scrollHeight - rect.height + 1);
}

function scroll_to_bottom() {
    const messages = $("messages");
    const rect = messages.getBoundingClientRect();
    messages.scrollTop = messages.scrollHeight - rect.height + 1;
}

function show(focus = true) {
    const chat_input = $("chat_input");
    set_var("chat-height", last_height);
    chat_input.value = "";
    scroll_to_bottom();
    if (focus) chat_input.focus();
}

function hide() {
    last_height = $("chat").getBoundingClientRect().height;
    $("chat_input").blur();
    set_var("chat-height", 0);
}

function toggle(focus) {
    visible = !visible;
    if (visible) {
        show(focus);
    } else {
        hide();
    }
}

function chat_input_focus(event) {
    send("chat_input_focus");
}

function chat_input_blur(event) {
    send("chat_input_blur");
}

electron.ipcRenderer.on("chat_window_toggle", (event) => toggle());

function validate(value) {
    return /^((https?):\/\/|www.|[^@]+@[^\.]+\..+$|#\d+$)/.test(value);
}

class ChatUI extends events.EventEmitter {
    add_click_event(link) {
        return (event) => {
            const match = link.href.match(/^row:\/\/#(\d+)/);
            if (match) {
                this.emit("goto_row", match[1]);
                return false;
            } else {
                electron.shell.openExternal(link.href);
            }
            event.preventDefault();
        };
    }

    linkify(element, text) {
        element.innerHTML = linkify_string(text, {className: "", formatHref: {ticket: (line_no) => `row://${line_no}`}, validate});
        const links = element.getElementsByTagName("a");
        for (const link of links) {
            link.setAttribute("tabIndex", -1);
            link.addEventListener("click", this.add_click_event(link), true);
        }
    }

    append(child, container = true) {
        const scroll = is_at_bottom();
        if (container) child = this.create_div({child});
        $("messages").appendChild(child);
        if (scroll) scroll_to_bottom();
    }

    create_div({classname, text, parent, child, linkify = false} = {}) {
        const element = document.createElement("div");
        if (classname) element.classList.add(classname);
        if (text && linkify) {
            this.linkify(element, text);
        } else  if (text) {
            element.innerText = text;
        }
        if (parent) parent.appendChild(element);
        if (child) element.appendChild(child);
        return element;
    }

    msg_div(text) {
        const msg_div = document.createElement("div");
        this.linkify(msg_div, text);
        this.append(msg_div);
    }

    action(id, text) {
        this.append(this.create_div({classname: "nick", text: `${this.users[id].nick} has ${text}`}));
    }

    sauce(id) {
        this.action(id, "changed the sauce record");
    }

    ice_colors(id, value) {
        this.action(id, `has turned iCE colors ${value ? "on" : "off"}`);
    }

    use_9px_font(id, value) {
        this.action(id, `has turned letter spacing ${value ? "on" : "off"}`);
    }

    change_font(id, font_name) {
        this.action(id, `has changed the font to ${font_name}`);
    }

    set_canvas_size(id, columns, rows) {
        this.action(id, `has changed the size of the canvas to ${columns} × ${rows}`);
    }

    status(id, status) {
        switch (status) {
            case statuses.ACTIVE: this.users[id].element.style.backgroundImage = "url(\"../img/active_indicator.png\")"; break;
            case statuses.IDLE: this.users[id].element.style.backgroundImage = "url(\"../img/idle_indicator.png\")"; break;
            case statuses.AWAY: this.users[id].element.style.backgroundImage = "url(\"../img/away_indicator.png\")"; break;
            case statuses.WEB: this.users[id].element.style.backgroundImage = "url(\"../img/web_indicator.png\")"; break;
        }
    }

    join(id, nick, group, status, show_join = true) {
        this.users[id] = {nick, group, status, element: this.create_div({text: nick, parent: $("user_list")})};
        this.users[id].element.addEventListener("click", (event) => this.emit("goto_user", id), false);
        if (show_join) this.action(id, "joined");
        this.status(id, status);
    }

    leave(id) {
        this.action(id, "left");
        $("user_list").removeChild(this.users[id].element);
        delete this.users[id];
    }

    welcome(comments, chat_history) {
        const element = $("user_list");
        while (element.firstChild) element.removeChild(element.firstChild);
        for (const chat of chat_history) this.chat(chat.id, chat.nick, chat.group, chat.text);
        const text = comments.split("\n")[0];
        if (text.length) this.append(this.create_div({classname: "welcome", text, linkify: true}), false);
    }

    show() {
        if (!visible) toggle(false);
        send("enable_chat_window_toggle");
    }

    mouse_down(event) {
        this.mouse_button = true;
    }

    chat(id, nick, group, text) {
        if (this.users[id] && this.users[id].element.nick != nick) this.users[id].element.innerText = nick;
        const nick_div = this.create_div({classname: "nick", text: `${nick} <${group}>`});
        const text_div = this.create_div({classname: "text", text, linkify: true});
        const container = this.create_div();
        container.appendChild(nick_div);
        container.appendChild(text_div);
        this.append(container, false);
    }

    mouse_move(event) {
        if (this.mouse_button) {
            const scroll = is_at_bottom();
            const new_height = $("chat").getBoundingClientRect().bottom - event.clientY;
            set_var("chat-height", Math.max(new_height, 96));
            if (scroll) scroll_to_bottom();
            this.emit("update_frame");
        }
    }

    mouse_up() {
        this.mouse_button = false;
    }

    constructor() {
        super();
        this.mouse_button = false;
        this.users = {};
        document.addEventListener("DOMContentLoaded", (event) => {
            $("chat_input").addEventListener("focus", chat_input_focus, true);
            $("chat_input").addEventListener("blur", chat_input_blur, true);
            $("chat_resizer").addEventListener("mousedown", (event) => this.mouse_down(event), true);
            document.body.addEventListener("mousemove", (event) => this.mouse_move(event), true);
            document.body.addEventListener("mouseup", () => this.mouse_up(), true);
        }, true);
    }
}

module.exports = new ChatUI();
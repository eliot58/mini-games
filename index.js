"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var init_data_node_1 = require("@telegram-apps/init-data-node");
var initData = (0, init_data_node_1.sign)({
    can_send_after: 10000,
    chat: {
        id: 1,
        type: 'group',
        username: 'my-chat',
        title: 'chat-title',
        photoUrl: 'chat-photo',
    },
    chat_instance: '888',
    chat_type: 'sender',
    query_id: 'QUERY',
    receiver: {
        added_to_attachment_menu: false,
        allows_write_to_pm: true,
        first_name: 'receiver-first-name',
        id: 991,
        is_bot: false,
        is_premium: true,
        language_code: 'ru',
        last_name: 'receiver-last-name',
        photo_url: 'receiver-photo',
        username: 'receiver-username',
    },
    start_param: 'debug',
    user: {
        added_to_attachment_menu: false,
        allows_write_to_pm: false,
        first_name: 'user-first-name',
        id: 1,
        is_bot: true,
        is_premium: false,
        language_code: 'en',
        last_name: 'user-last-name',
        photo_url: 'user-photo',
        username: 'user-username',
    },
}, '7855242511:AAGIeUvizvLx48K969o0c9HMcXISuQLPoYY', new Date(1000));
console.log(initData);

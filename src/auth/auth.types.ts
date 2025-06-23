import { Request } from 'express';
import { Socket } from 'socket.io';

export type AuthPayload = {
    tgId: string;
    username: string;
    photo_url: string;
};

export type RequestWithAuth = Request & AuthPayload;

export type SocketWithAuth = Socket & AuthPayload;
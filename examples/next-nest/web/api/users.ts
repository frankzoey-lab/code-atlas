import client, { api } from './instance';

declare function receiveEvent(e: string, f: () => void): void;

export function listUsers() {
  return api.get('users');
}

export function readUser(id: string) {
  return client.get(`/users/${id}`);
}

export function archive() {
  return api.get('/archive/2024');
}

export function onPong() {
  receiveEvent('pong-me', () => {});
}

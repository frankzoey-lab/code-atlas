import { CLIP_KEYS } from '@/api/keys';

const BASE = process.env.NEXT_PUBLIC_API_URL;

export function fetchClip(uuid: string) {
  return axios.get(`${BASE}${CLIP_KEYS.CLIP}/${uuid}?full=1`);
}

export function fetchTop() {
  return axios.get(process.env.NEXT_PUBLIC_API_URL + CLIP_KEYS.TOP);
}

export function deleteClip(uuid: string) {
  return axios({ url: `${BASE}/clip/${uuid}`, method: 'delete' });
}

export function sendChat(text: string) {
  return fetch(`${process.env.NEXT_PUBLIC_API_URL}/chat/messages`, { method: 'POST', body: text });
}

export function missing() {
  return axios.get(`${BASE}/nowhere`);
}

export function shareLink(uuid: string) {
  return `${process.env.NEXT_PUBLIC_SHARE_URL}/${uuid}`;
}

const BASE = process.env.NEXT_PUBLIC_API_URL;
const { NEXT_PUBLIC_API_URL: DESTRUCTURED } = process.env;

const apiClient = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL });

export function viaInstance() {
  return apiClient.get('/items');
}

export function viaRequest() {
  return axios.request({ url: `${BASE}/items`, method: 'GET' });
}

export function viaDestructured() {
  return axios.get(`${DESTRUCTURED}/items/list`);
}

export function wrapper(path: string) {
  return axios.get(`${BASE}${path}`);
}

export function withQuery(qs: string) {
  return axios.get(`${BASE}/items${qs}`);
}

export function reassigned(deep: boolean) {
  let url = `${BASE}/items`;
  if (deep) url = `${BASE}/other/deep`;
  return axios.get(url);
}

export function ternary(flag: boolean) {
  return axios.get(flag ? `${BASE}/items/list` : `${BASE}/inherited/base`);
}

const INIT = { method: 'POST' };
export function fetchWithInit() {
  return fetch(`${BASE}/chat/messages`, INIT);
}

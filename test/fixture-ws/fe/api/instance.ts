export const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL + '/v1' });

export default axios.create({ baseURL: `${process.env.NEXT_PUBLIC_API_URL}/v1` });

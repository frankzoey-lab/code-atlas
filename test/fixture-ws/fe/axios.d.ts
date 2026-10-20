interface AxiosLike {
  get(url: string, config?: object): Promise<unknown>;
  post(url: string, body?: unknown, config?: object): Promise<unknown>;
  request(config: { url: string; method?: string }): Promise<unknown>;
}
declare const axios: AxiosLike & {
  (config: { url: string; method?: string }): Promise<unknown>;
  create(config: { baseURL?: string }): AxiosLike;
};
declare const process: { env: Record<string, string | undefined> };

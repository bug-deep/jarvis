// Telegram Bot API через SOCKS5: с домашнего сервера api.telegram.org
// напрямую закрыт, поэтому grammY получает свой fetch.
import nodeFetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';

export function proxyFetch(proxyUrl) {
  const agent = new SocksProxyAgent(proxyUrl);
  return (url, options = {}) => nodeFetch(url, { ...options, agent });
}

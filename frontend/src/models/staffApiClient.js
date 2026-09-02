import client from './apiClient';

const merge = (config) => ({ ...(config || {}), asStaff: true });

export default {
  get: (url, config) => client.get(url, merge(config)),
  post: (url, data, config) => client.post(url, data, merge(config)),
  patch: (url, data, config) => client.patch(url, data, merge(config)),
  put: (url, data, config) => client.put(url, data, merge(config))
};

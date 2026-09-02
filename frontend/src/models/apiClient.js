import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const client = axios.create({ baseURL: API_URL });

client.interceptors.request.use((config) => {
  const candidateToken = localStorage.getItem('candidateToken');
  const staffToken = localStorage.getItem('staffToken');
  const token = config.asStaff ? staffToken : candidateToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;

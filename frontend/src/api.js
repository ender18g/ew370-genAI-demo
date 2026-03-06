import axios from 'axios';

export const api = axios.create({
  baseURL: '/',
});

export function getOrCreateStudentId() {
  const key = 'ew370_student_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `student_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, id);
  return id;
}

// localStorage seguro (puede fallar en ventanas privadas o con el almacenamiento bloqueado).
export const lsGet = (k: string, d = ""): string => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
export const lsSet = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento */
  }
};

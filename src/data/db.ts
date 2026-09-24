import Dexie, { type Table } from 'dexie';

export interface SettingRow {
  key: string;
  value: unknown;
}

class PosternDB extends Dexie {
  settings!: Table<SettingRow, string>;

  constructor() {
    super('PosternDB');

    this.version(1).stores({
      settings: 'key',
    });
  }
}

export const db = new PosternDB();

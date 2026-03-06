import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "../dashboard/data");

export class Storage {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  read<T = unknown>(file: string, fallback: T): T {
    const p = path.join(DATA_DIR, file);
    if (!fs.existsSync(p)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
    } catch {
      return fallback;
    }
  }

  write(file: string, data: unknown): void {
    fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
    console.log(`  💾 dashboard/data/${file}`);
  }

  appendHistory(entry: Record<string, unknown>): void {
    const h = this.read<Record<string, unknown>[]>("history.json", []);
    const filtered = h.filter((r) => r.date !== entry.date);
    filtered.push(entry);
    this.write("history.json", filtered.slice(-90));
  }
}

import fs from "fs";
import csv from "csv-parser";
import { Index } from "@upstash/vector";

interface Row {
  team: string;
}

const index = new Index({
  url: "",
  token: "",
});

async function parseCSV(filePath: string): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const rows: Row[] = [];

    fs.createReadStream(filePath)
      .pipe(
        csv({
          separator: ",",
        })
      )
      .on("data", (row) => {
        rows.push(row);
      })
      .on("error", (err) => {
        reject(err);
      })
      .on("end", () => {
        resolve(rows);
      });
  });
}

const STEP = 10;

const seed = async () => {
  try {
    const data = await parseCSV("training_dataset.csv");

    for (let i = 0; i < data.length; i += STEP) {
      const chunk = data.slice(i, i + STEP);

      const formatted = chunk.map((row, batchIndex) => ({
        data: row.team,
        id: i + batchIndex,
        metadata: { team: row.team },
      }));

      await index.upsert(formatted);
    }
  } catch (error) {
    console.error(error);
  }
};

seed();

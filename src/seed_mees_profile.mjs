import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, "work", "family_profile.local.json");

const profile = {
  profile_id: "family-mees-local",
  locale: "nl-NL",
  source: {
    note: "Seeded from the filled top section of the attached school intake DOCX."
  },
  child: {
    full_name: "Mees Cornelius Jack",
    preferred_name: "Mees",
    birthdate: "2022-06-13"
  },
  parents_or_guardians: [
    {
      full_name: "Tim Verhoogt"
    },
    {
      full_name: "Nonni Verhoogt"
    }
  ],
  household: {
    address: "Mezenhof 126, 1742 GN Schagen"
  },
  care: {
    general_practitioner: {
      name: "Van Steen",
      phone: "0224-212648"
    },
    dentist: {
      name: "Tandartsenpraktijk Waldervaart",
      phone: "0224-296060"
    },
    after_school_care: {
      name: "Kappio, locatie de Ark"
    }
  },
  preferences: {
    final_answer_style: "warm, feitelijk, kort genoeg voor een schoolformulier",
    interview_language: "nl-NL"
  }
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
console.log(`Wrote local family profile: ${outPath}`);


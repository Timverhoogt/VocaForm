import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, "work", "family_profile.local.json");

const profile = {
  profile_id: "family-example-local",
  locale: "nl-NL",
  source: {
    note: "Generic example profile for local testing. Replace in work/family_profile.local.json with private real data."
  },
  child: {
    full_name: "Example Child",
    preferred_name: "Example",
    birthdate: ""
  },
  parents_or_guardians: [
    {
      full_name: "Example Guardian 1"
    },
    {
      full_name: "Example Guardian 2"
    }
  ],
  household: {
    address: "Example Street 1, 1234 AB Example City"
  },
  care: {
    general_practitioner: {
      name: "Example GP Practice",
      phone: "<gp phone>"
    },
    dentist: {
      name: "Example Dental Practice",
      phone: "<dentist phone>"
    },
    after_school_care: {
      name: "Example after-school care"
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

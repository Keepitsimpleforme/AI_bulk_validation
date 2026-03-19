import { exec } from "child_process";

// The times we want the script to actually run (20 minutes before dashboard refresh)
// Formatted in strictly 24-hour IST (Asia/Kolkata) time format
const PUSH_SCHEDULE = [
  "07:40",
  "09:10",
  "10:40",
  "12:10",
  "13:40",
  "15:10",
  "16:40",
  "18:10",
  "19:40",
  "21:10",
  "22:40"
];

const formatter = new Intl.DateTimeFormat('en-US', { 
  timeZone: 'Asia/Kolkata', 
  hour12: false, 
  hour: '2-digit', 
  minute: '2-digit' 
});

console.log("⏳ Smart Publisher Loop Started.");
console.log(`Targeting strictly these push times (IST): ${PUSH_SCHEDULE.join(", ")}`);

const checkAndRun = () => {
  const nowRaw = new Date();
  const currentTimeIST = formatter.format(nowRaw).replace(/^24:/, "00:"); // Handles edge-case midnight mapping
  
  if (PUSH_SCHEDULE.includes(currentTimeIST)) {
    console.log(`\n⏰ Exact Time Match Hit: ${currentTimeIST} IST! Spawning publisher action...`);
    
    // Executes the hourly publish command locally with a 20-minute timeout for massive batch processing
    exec("HOURLY_PUBLISH_TIMEOUT_MS=1200000 npm run worker:hourly-publish", (error, stdout, stderr) => {
      if (stdout) console.log(`[PUBLISHER OUTPUT] ${stdout}`);
      if (stderr) console.error(`[PUBLISHER ERROR] ${stderr}`);
      if (error) console.error(`[CRITICAL] Publish Execution Failed: ${error}`);
      console.log(`✅ Publisher execution finished. Entering sleep phase until next target...`);
    });
  }
};

// Check the clock exactly every 60 seconds
setInterval(checkAndRun, 60000);

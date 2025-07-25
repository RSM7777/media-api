import fs from "fs/promises";
import path from "path";
import axios from "axios";

const API_URL = "http://20.57.133.60:8080/generate-video";
const AUDIO_PATH = path.join(process.cwd(), "test-data", "test.mp3");
const OUTPUT_VIDEO_PATH = "final_output.mp4";

async function main() {
  try {
    console.log("--- Starting Final Local Test ---");

    const audioBuffer = await fs.readFile(AUDIO_PATH);

    // This is the simple JSON payload we send now
    const payload = {
      title: "A Letter to a Friend",

      content:
        "Dear You,\n\nIf you're reading this letter, it means you've reached a moment in life where words, memories, and meaning matter. Maybe you're sitting by a window watching the rain fall. Maybe it's 2 AM and the world is asleep, but your mind is wide awake, searching for something real. Maybe you're in a good place. Or maybe you're trying to find your way back to yourself. Whatever the case—I'm glad you're here.\n\nLet’s go back, for a moment. Remember the days when everything felt simple? When happiness was a bicycle, a mango in summer, or sitting with your best friend laughing at the dumbest jokes. There were no deadlines, no heartbreaks that tore you apart, no expectations weighing you down. Just you and the world, untamed and untouched.\n\nLife has changed. You’ve grown. You've lost people. Some walked away, some drifted slowly, some were taken too soon. And you miss them, don’t you? You remember the way they laughed, the advice they gave, the way their presence made everything feel lighter. And now, even though the world moves forward, their memory still lives in tiny, quiet corners of your heart.\n\nYou’ve also changed. You’re not the same person you were five years ago. Or even one year ago. And that’s okay. Growth doesn’t always look like victory. Sometimes, it looks like survival. Like crying alone but still waking up the next morning. Like being broken but still choosing to love. Like failing but showing up again, anyway.\n\nDo you remember your first heartbreak? How it felt like the world cracked open? Like your chest was a hollow room echoing with pain? But look at you now. You survived. You healed in ways you didn’t think were possible. Your scars became stories. Your stories became strength. You are proof that pain doesn’t win unless you let it.\n\nNow look at your dreams. Some you chased. Some chased you. Some you lost, and some you never even dared to speak aloud. But the truth is, even unspoken dreams matter. They shape us. They keep us awake at night. They remind us that there is more to life than just going through the motions. If you still have dreams—fight for them. If you’ve forgotten them—go find them again. It’s never too late.\n\nThere were moments you wanted to give up. Times when it felt easier to disappear, to close yourself off, to numb the world out. But something inside you refused. Something small but powerful said: “Not yet.” That voice—that spark—it saved you. Don’t ignore it. That’s your fire. Protect it with your life.\n\nAnd don’t forget to forgive yourself. For the things you didn’t know. For the people you trusted. For the opportunities you missed. For the times you let fear win. You’re human. You’re not supposed to have it all figured out. Be kind to yourself. You deserve that much.\n\nRemember the way your mom calls your name? Or your dad’s silent support? Or the friend who stayed when others left? These people—they’re the anchors in your life. Tell them you love them. Don’t wait for birthdays or accidents or goodbyes. Love is meant to be loud. So let it be.\n\nAnd to the version of you that doubted everything—look at what you’ve survived. Look at the battles you’ve fought in silence. Look at the nights you held yourself together. That resilience is not just strength—it’s power. Don’t waste it on people who don’t see it. Don’t shrink for those who can’t handle your shine.\n\nThere is still so much waiting for you. Places you haven’t seen. People you haven’t met. Stories you haven’t written. And parts of yourself you haven’t even discovered yet. Don’t settle. Don’t stop. You are meant for more than just surviving. You are meant to live.\n\nRead this when you forget who you are.\nRead this when the weight of the world sits heavy on your chest.\nRead this when you need a reason to keep going.\n\nAnd know this:\nYou are not alone.\nYou never were.\nYou never will be.\n\nWith all the love I could possibly give,\n— Me",

      authorName: "Someone Who Cares",

      templateId: "3", // This would match a template on the server

      audioBufferBase64: audioBuffer.toString("base64"),
    };

    console.log(`Sending request to ${API_URL}...`);
    const response = await axios.post(API_URL, payload, {
      responseType: "arraybuffer",
    });

    await fs.writeFile(OUTPUT_VIDEO_PATH, response.data);
    console.log(
      `--- ✅ Test Complete! Video saved to ${OUTPUT_VIDEO_PATH} ---`
    );
  } catch (error) {
    console.error("--- ❌ Test Failed ---", error.message);
  }
}

main();

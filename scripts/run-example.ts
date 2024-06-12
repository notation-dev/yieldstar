import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";

const examplesDir = path.resolve(__dirname, "../examples");

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((file) => fs.statSync(path.join(dir, file)).isFile());
}

async function selectFile(files: string[]): Promise<string> {
  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "file",
      message: "Select a file to run:",
      choices: files,
    },
  ]);
  return answer.file;
}

async function runSelectedFile(filePath: string) {
  await import(filePath);
}

async function main() {
  const files = listFiles(examplesDir);
  if (files.length === 0) {
    console.error("No files found in examples directory.");
    return;
  }

  const selectedFile = await selectFile(files);
  const selectedFilePath = path.join(examplesDir, selectedFile);

  await runSelectedFile(selectedFilePath);
}

main().catch(console.error);

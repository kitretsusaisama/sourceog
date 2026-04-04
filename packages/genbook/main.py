import os

OUTPUT_FILE = "output.txt"

# Extensions to include (modify if needed)
INCLUDE_EXTENSIONS = None  # None = include all text files

# Skip these folders
EXCLUDE_DIRS = {".git", "node_modules", "__pycache__", "dist", "build"}


def is_binary(file_path):
    try:
        with open(file_path, "rb") as f:
            chunk = f.read(1024)
            return b"\0" in chunk
    except:
        return True


def should_include(file_path):
    if INCLUDE_EXTENSIONS is None:
        return True
    return any(file_path.endswith(ext) for ext in INCLUDE_EXTENSIONS)


def process_directory(root_dir):
    with open(OUTPUT_FILE, "w", encoding="utf-8") as output:

        for root, dirs, files in os.walk(root_dir):
            # Skip unwanted dirs
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for file in files:
                file_path = os.path.join(root, file)

                if not should_include(file_path):
                    continue

                if is_binary(file_path):
                    continue

                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()

                    # Write to output
                    output.write(f"\n--- {file_path} ---\n\n")
                    output.write(content)
                    output.write("\n\n")

                    print(f"✅ Processed: {file_path}")

                except Exception as e:
                    print(f"⚠️ Skipped: {file_path} ({e})")


if __name__ == "__main__":
    target_folder = input("Enter folder path: ").strip()

    if not os.path.exists(target_folder):
        print("❌ Folder does not exist")
    else:
        process_directory(target_folder)
        print(f"\n🔥 Done. Output saved to {OUTPUT_FILE}")
import os
from pathlib import Path
from openai import OpenAI


def load_env_file() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key:
            os.environ.setdefault(key, value)


def main() -> None:
    load_env_file()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY in environment or .env file")

    client = OpenAI(api_key=api_key)
    print("Введите запрос и нажмите Enter.")
    print("Для выхода введите: /exit")

    while True:
        try:
            prompt = input("\nВы: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nВыход.")
            break

        if not prompt:
            continue
        if prompt == "/exit":
            print("Выход.")
            break

        response = client.responses.create(
            model="gpt-4.1-mini",
            input=prompt,
        )
        print(f"LLM: {response.output_text}")


if __name__ == "__main__":
    main()

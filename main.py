import os
from pathlib import Path
import threading
import time
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


def show_loading(stop_event: threading.Event) -> None:
    frames = ["|", "/", "-", "\\"]
    i = 0
    while not stop_event.is_set():
        print(f"\rLLM думает... {frames[i % len(frames)]}", end="", flush=True)
        i += 1
        time.sleep(0.1)
    print("\r" + " " * 40 + "\r", end="", flush=True)


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

        stop_event = threading.Event()
        loader = threading.Thread(target=show_loading, args=(stop_event,), daemon=True)
        loader.start()

        response = None
        try:
            response = client.responses.create(
                model="gpt-4.1-mini",
                input=prompt,
            )
        finally:
            stop_event.set()
            loader.join()

        print(f"LLM: {response.output_text}")


if __name__ == "__main__":
    main()

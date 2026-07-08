from sentence_transformers import SentenceTransformer
import torch
import os
import psutil

print(f"Using torch version: {torch.__version__}")
print(f"Is CUDA available: {torch.cuda.is_available()}")
print(f"Number of CPU threads available: {os.cpu_count()}")

# Load a lightweight model
model_name = 'all-MiniLM-L6-v2'
print(f"Loading model: {model_name}...")
model = SentenceTransformer(model_name)
print("Model loaded successfully.")

# Test sentences
sentences = [
    "Це перше тестове речення.",
    "Це друге речення для перевірки.",
    "Ще одне речення.",
    "Генерація ембеддінгів - важливий крок.",
    "Прототип працює.",
    "Українська мова.",
    "ШІ-агент.",
    "Довготривала пам'ять.",
    "Векторний пошук.",
    "Оптимізація ресурсів."
]

print(f"Generating embeddings for {len(sentences)} sentences...")
embeddings = model.encode(sentences)
print("Embeddings generated successfully.")

print(f"Shape of embeddings: {embeddings.shape}")

# Monitor resource usage (basic snapshot)
process = psutil.Process(os.getpid())
mem_info = process.memory_info()
cpu_percent = process.cpu_percent(interval=1)

print(f"Current RAM usage: {mem_info.rss / (1024 * 1024):.2f} MB")
print(f"Current CPU usage: {cpu_percent:.2f}%")

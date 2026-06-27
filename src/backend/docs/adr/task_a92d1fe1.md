# Architectural Decision: Аналіз та вибір локальної векторної бази даних (Qdrant vs Chroma vs pgvector) для архітектури ARM64 

- **Task ID:** a92d1fe1-2797-4356-8d0c-6c9864796b16
- **Date:** unknown

## Rationale
Обраний підхід базується на емпіричній перевірці, а не на теоретичних припущеннях. Шляхом прямого бенчмаркінгу кандидатів на цільовому обладнанні ARM64 з репрезентативним робочим навантаженням ми гарантуємо, що обране рішення відповідає вимогам продуктивності та ресурсів, мінімізуючи ризики інтеграції на пізніших етапах проєкту. Це також задовольняє домінуючий драйв 'curiosity' через глибоке дослідження та порівняння технологій.

## Required Capabilities
- Python 3.x
- Docker/Podman
- PostgreSQL
- Qdrant client library
- ChromaDB client library
- psycopg2 (or similar PostgreSQL client for Python)
- Embedding models (e.g., Sentence Transformers, ONNX Runtime)
- System monitoring tools (e.g., htop, iostat, psutil)
- Git
- SSH

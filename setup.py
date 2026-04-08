#!/usr/bin/env python
"""A minimal, editable `setup.py` for the project.

This file uses a modern setuptools pattern with a `src/` layout.
Edit metadata (author, email, description, classifiers, dependencies) as needed.
"""
from pathlib import Path

from setuptools import find_packages, setup

HERE = Path(__file__).parent

# Read long description from README if available
README = (HERE / "README.md").read_text(encoding="utf-8") if (HERE / "README.md").exists() else ""

# Try to read __version__ from package if present, otherwise fall back to 0.0.0
def read_version():
    version_file = HERE / "src" / "procmap" / "__init__.py"
    if version_file.exists():
        for line in version_file.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("__version__"):
                # supports formats: __version__ = '0.1.0' or "0.1.0"
                delim = '"' if '"' in line else "'"
                return line.split(delim)[1]
    return "0.0.0"

# Find packages in src/ (handles ordinary packages). If none found, try namespace packages.
packages = find_packages(where="src")
if not packages:
    try:
        from setuptools import find_namespace_packages

        packages = find_namespace_packages(where="src")
    except Exception:
        packages = []

setup(
    name="procmap",
    version=read_version(),
    description="Visualizer for processes and their interconnections",
    long_description=README,
    long_description_content_type="text/markdown",
    author="Eugene Gubenkov",
    author_email="gubenkoved@gmail.com",
    url="https://github.com/gubenkoved/procmap",
    packages=packages,
    package_dir={"": "src"},
    include_package_data=True,
    package_data={"procmap": ["dist/*", "dist/**/*"]},
    zip_safe=False,
    python_requires=">=3.12",
    install_requires=[
        "psutil",
        "coloredlogs",
        "fastapi>=0.95",
        "uvicorn[standard]>=0.20",
    ],
    classifiers=[
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "License :: OSI Approved :: MIT License",
        "Operating System :: POSIX :: Linux",
        "Topic :: System :: Monitoring",
        "Topic :: System :: Systems Administration",
        "Environment :: Web Environment",
        "Framework :: FastAPI",
        "Intended Audience :: Developers",
        "Intended Audience :: System Administrators",
    ],
    keywords=[
        "process",
        "visualization",
        "graph",
        "ipc",
        "system",
        "monitoring",
        "linux",
        "procfs",
    ],
    entry_points={
        "console_scripts": [
            "procmap=procmap.app:main",
        ],
    },
    license="MIT",
    project_urls={
        "Source": "https://github.com/gubenkoved/procmap",
        "Issues": "https://github.com/gubenkoved/procmap/issues",
    },
)

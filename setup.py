#!/usr/bin/env python
"""A minimal, editable `setup.py` for the project.

This file uses a modern setuptools pattern with a `src/` layout.
Edit metadata (author, email, description, classifiers, dependencies) as needed.
"""
from pathlib import Path
from setuptools import setup, find_packages

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
    name="proc-map",
    version=read_version(),
    description="Visualizer for processes and their interconnections",
    long_description=README,
    long_description_content_type="text/markdown",
    author="Eugene Gubenkov",
    author_email="gubenkoved@gmail.com",
    url="https://github.com/gubenkoved/proc-map",
    packages=packages,
    package_dir={"": "src"},
    include_package_data=True,
    python_requires=">=3.12",
    install_requires=[
        "psutil",
        "coloredlogs",
    ],
    extras_require={
        "dev": [
            "pytest",
            "black",
            "isort",
        ]
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    project_urls={
        "Source": "https://github.com/gubenkoved/proc-map",
        "Issues": "https://github.com/gubenkoved/proc-map/issues",
    },
)

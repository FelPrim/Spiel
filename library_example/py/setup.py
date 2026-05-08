from setuptools import setup, Extension

extension = Extension(
    name="spiel",
    sources=["../src/spiellib.c", "wrapper.c"],
    include_dirs=[".", "../src/"]
)

setup(
    name="spiel",
    version="0.0",
    ext_modules=[extension]
)

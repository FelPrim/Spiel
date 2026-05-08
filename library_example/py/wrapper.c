#include <Python.h>
#include "../src/spiellib.h"

static PyObject* py_change_state(PyObject* self, PyObject* args){
	(void)self;
	(void)args;

	change_state();
	Py_RETURN_NONE;
}

static PyMethodDef methods[] = {
	{"change_state", py_change_state, METH_NOARGS, 
	"Инкрементирует счётчик и печатает его."},
	{NULL, NULL, 0, NULL}
};

static struct PyModuleDef module = {
	PyModuleDef_HEAD_INIT,
	"spiel",
	"Обёртка над C-библиотекой",
	-1,
	methods
};

PyMODINIT_FUNC PyInit_spiel(void){
	// Do nothing
	return PyModule_Create(&module);
}

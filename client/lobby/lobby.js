document.addEventListener('DOMContentLoaded', () => {
    const loadMapBtn = document.getElementById('load-map');
    const mapFileInput = document.getElementById('map-file');
    const mapDisplay = document.getElementById('map-display');
    const mapStatus = document.getElementById('map-status');

    let loadedMapData = null; // { mapBlob, mapUrl, voronojCanvas, voronojData32, overlayCanvas, overlayCtx, info, selectedIndex }

    loadMapBtn.addEventListener('click', () => {
        mapFileInput.click();
    });

    mapFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.spielmap')) {
            mapStatus.textContent = 'Ошибка: файл должен иметь расширение .spielmap';
            return;
        }

        mapStatus.textContent = 'Загрузка...';

        try {
            const zip = await JSZip.loadAsync(file);

            // Ищем файл карты (map.*)
            const mapEntryName = Object.keys(zip.files).find(name => name.startsWith('map.'));
            if (!mapEntryName) throw new Error('В архиве не найден файл карты (map.*)');

            // Извлекаем blob карты
            const mapBlob = await zip.file(mapEntryName).async('blob');
            const mapUrl = URL.createObjectURL(mapBlob);

            // Извлекаем voronoj.png
            const voronojEntry = zip.file('voronoj.png');
            if (!voronojEntry) throw new Error('В архиве не найден файл voronoj.png');
            const voronojBlob = await voronojEntry.async('blob');
            const voronojUrl = URL.createObjectURL(voronojBlob);

            // Извлекаем info.json
            const infoEntry = zip.file('info.json');
            if (!infoEntry) throw new Error('В архиве не найден файл info.json');
            const infoText = await infoEntry.async('text');
            const info = JSON.parse(infoText);

            // Загружаем voronoj.png в canvas (в памяти)
            const voronojImg = new Image();
            voronojImg.src = voronojUrl;
            await new Promise((resolve, reject) => {
                voronojImg.onload = resolve;
                voronojImg.onerror = reject;
            });

            const voronojCanvas = document.createElement('canvas');
            voronojCanvas.width = voronojImg.naturalWidth;
            voronojCanvas.height = voronojImg.naturalHeight;
            const vctx = voronojCanvas.getContext('2d', { willReadFrequently: true });
            vctx.drawImage(voronojImg, 0, 0);

            // Получаем данные для быстрого сравнения цветов
            const imageData = vctx.getImageData(0, 0, voronojCanvas.width, voronojCanvas.height);
            const data = imageData.data;
            const voronojData32 = new Uint32Array(voronojCanvas.width * voronojCanvas.height);
            for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                voronojData32[j] = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
            }

            // Создаём overlay canvas для выделения
            const overlayCanvas = document.createElement('canvas');
            overlayCanvas.id = 'map-overlay';
            overlayCanvas.width = voronojCanvas.width;
            overlayCanvas.height = voronojCanvas.height;
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.top = '0';
            overlayCanvas.style.left = '0';
            overlayCanvas.style.width = '100%';
            overlayCanvas.style.height = '100%';
            overlayCanvas.style.pointerEvents = 'none';
            overlayCanvas.style.zIndex = '2';
            const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });

            // Очищаем контейнер и добавляем карту и overlay
            mapDisplay.innerHTML = '';
            const img = document.createElement('img');
            img.src = mapUrl;
            img.alt = 'Загруженная карта';
            img.id = 'loaded-map-image';
            mapDisplay.appendChild(img);
            mapDisplay.appendChild(overlayCanvas);

            // Сохраняем данные
            loadedMapData = {
                mapBlob,
                mapUrl,
                voronojCanvas,
                voronojData32,
                overlayCanvas,
                overlayCtx,
                info,
                selectedIndex: -1
            };

            // Обработчик клика
            img.addEventListener('click', (event) => {
                if (!loadedMapData) return;
                const rect = img.getBoundingClientRect();
                const scaleX = img.naturalWidth / rect.width;
                const scaleY = img.naturalHeight / rect.height;
                const x = Math.floor((event.clientX - rect.left) * scaleX);
                const y = Math.floor((event.clientY - rect.top) * scaleY);

                const idx = (y * voronojCanvas.width + x);
                if (idx < 0 || idx >= voronojData32.length) return;

                const colorAtClick = voronojData32[idx];
                const colors = loadedMapData.info.colors;
                const index = colors.indexOf(colorAtClick);
                if (index === -1) {
                    mapStatus.textContent = `Цвет ${colorAtClick} не найден. Координаты: ${x},${y}`;
                    return;
                }

                // Если кликнули по уже выделенной провинции — снимаем выделение
                if (loadedMapData.selectedIndex === index) {
                    loadedMapData.overlayCtx.clearRect(0, 0, loadedMapData.overlayCanvas.width, loadedMapData.overlayCanvas.height);
                    loadedMapData.selectedIndex = -1;
                    mapStatus.textContent = `Выделение снято (ID: ${index})`;
                    return;
                }

                // Выделяем новую провинцию
                const overlayImageData = loadedMapData.overlayCtx.createImageData(loadedMapData.overlayCanvas.width, loadedMapData.overlayCanvas.height);
                const odata = overlayImageData.data;
                const targetColor = colors[index];
                for (let i = 0; i < loadedMapData.voronojData32.length; i++) {
                    if (loadedMapData.voronojData32[i] === targetColor) {
                        const p = i * 4;
                        odata[p] = 255;
						odata[p + 1] = 255;
						odata[p + 2] = 255; // белый
						odata[p + 3] = 60;  // низкая непрозрачность
                    }
                }
                loadedMapData.overlayCtx.putImageData(overlayImageData, 0, 0);
                loadedMapData.selectedIndex = index;
                mapStatus.textContent = `Провинция ID: ${index}`;
            });

            mapStatus.textContent = `Карта загружена: ${mapEntryName}`;
        } catch (err) {
            console.error(err);
            mapStatus.textContent = 'Ошибка загрузки: ' + err.message;
        } finally {
            mapFileInput.value = '';
        }
    });
});
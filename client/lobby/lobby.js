document.addEventListener('DOMContentLoaded', () => {
    const loadMapBtn = document.getElementById('load-map');
    const mapFileInput = document.getElementById('map-file');
    const mapDisplay = document.getElementById('map-display');
    const mapStatus = document.getElementById('map-status');

    let loadedMapData = null; // { mapBlob, mapUrl, voronojCanvas, info }

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

            // Сохраняем данные
            loadedMapData = {
                mapBlob,
                mapUrl,
                voronojCanvas,
                info
            };

            // Отображаем карту (убираем предыдущий canvas)
            mapDisplay.innerHTML = '';
            const img = document.createElement('img');
            img.src = mapUrl;
            img.alt = 'Загруженная карта';
            img.id = 'loaded-map-image';
            mapDisplay.appendChild(img);

            // Обработчик клика
            img.addEventListener('click', (event) => {
				if (!loadedMapData) return;
				const rect = img.getBoundingClientRect();
				const scaleX = img.naturalWidth / rect.width;
				const scaleY = img.naturalHeight / rect.height;
				const x = Math.floor((event.clientX - rect.left) * scaleX);
				const y = Math.floor((event.clientY - rect.top) * scaleY);

				console.log('Клик по координатам:', x, y);

				// Получаем пиксель из невидимого canvas
				const pixel = loadedMapData.voronojCanvas
					.getContext('2d')
					.getImageData(x, y, 1, 1).data;
				const colorInt = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];

				console.log('Пиксель RGBA:', pixel[0], pixel[1], pixel[2], pixel[3]);
				console.log('Числовой цвет:', colorInt);
				console.log('Массив colors:', loadedMapData.info.colors);
				console.log('Индекс цвета:', loadedMapData.info.colors.indexOf(colorInt));

				const index = loadedMapData.info.colors.indexOf(colorInt);
				if (index !== -1) {
					mapStatus.textContent = `Провинция ID: ${index}`;
				} else {
					mapStatus.textContent = `Цвет ${colorInt} не найден. Координаты: ${x},${y}`;
				}
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
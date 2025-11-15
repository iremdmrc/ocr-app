# ocr/trocr_infer.pyP

from transformers import TrOCRProcessor, VisionEncoderDecoderModel  # type: ignore

# İstersen büyük modelleri de deneyebilirsin:
# PRINTED = "microsoft/trocr-large-printed"
# HANDWR  = "microsoft/trocr-large-handwritten"
PRINTED = "microsoft/trocr-base-printed"
HANDWR  = "microsoft/trocr-base-handwritten"

# Modelleri global scope'ta bir kez yükleyelim (her çağrıda yeniden indirmesin)
try:
    _proc_p = TrOCRProcessor.from_pretrained(PRINTED)
    _model_p = VisionEncoderDecoderModel.from_pretrained(PRINTED)
    _proc_h = TrOCRProcessor.from_pretrained(HANDWR)
    _model_h = VisionEncoderDecoderModel.from_pretrained(HANDWR)
except Exception as e:
    # Hata mesajını yükselt; çoğu zaman internet/erişim kaynaklı olur
    raise RuntimeError(f"TrOCR modelleri yüklenemedi: {e}")

def run_trocr(pil_img, handwritten=False, max_len=112, beams=5):
    """
    Tek kırpım (tek satıra yakın) resim için metin üretir.
    - pil_img: PIL.Image (RGB)
    - handwritten: True → el yazısı modeli, False → basılı metin modeli
    """
    if handwritten:
        pixel_values = _proc_h(images=pil_img, return_tensors="pt").pixel_values
        generated_ids = _model_h.generate(pixel_values, max_length=max_len, num_beams=beams)
        text = _proc_h.batch_decode(generated_ids, skip_special_tokens=True)[0]
    else:
        pixel_values = _proc_p(images=pil_img, return_tensors="pt").pixel_values
        generated_ids = _model_p.generate(pixel_values, max_length=max_len, num_beams=beams)
        text = _proc_p.batch_decode(generated_ids, skip_special_tokens=True)[0]
    return text.strip()
